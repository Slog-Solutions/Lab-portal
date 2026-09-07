import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { ALL_STATIONS_ROOM, CONTROL_NAMESPACE, groupRoom, sessionRoom, stationRoom } from '@lab/shared/events';
import {
  StationLifecycle,
  type CommandAck,
  type StationHeartbeat,
  type StationHello,
  type StationHelloAck,
} from '@lab/shared';
import type { JwtPayload } from '../auth/auth.service';
import { StationsService } from '../stations/stations.service';
import { AuditService } from '../audit/audit.service';
import { PresenceService } from './presence.service';
import { SessionStateService } from './session-state.service';
import { LockService } from './lock.service';
import { CommandsService } from './commands.service';

const LOCK_HEARTBEAT_INTERVAL_MS = 15_000; // design doc §3.3 — must be < the 30s auto-unlock threshold

interface AuthedSocket extends Socket {
  data: { auth?: { kind: 'station'; stationId: string } | { kind: 'user'; user: JwtPayload } };
}

/**
 * The /control namespace (design doc §4.1-4.4). Deliberately separate from
 * LiveKit — control must survive media being down, since the unlock
 * failsafe cannot depend on WebRTC.
 *
 * Two kinds of clients connect here:
 *  - Stations (the Electron client), authenticated by station credentials,
 *    which send station:hello/heartbeat and receive session:snapshot/command.
 *  - Dashboards (teacher/admin web), authenticated by JWT, which receive
 *    lab:status and drive commands via the REST/control HTTP API (not
 *    this gateway directly — see build plan Phase 1).
 */
@WebSocketGateway({
  namespace: CONTROL_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class ControlGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(ControlGateway.name);
  private sweepTimer?: NodeJS.Timeout;
  private lockHeartbeatTimer?: NodeJS.Timeout;

  constructor(
    private readonly jwt: JwtService,
    private readonly stations: StationsService,
    private readonly presence: PresenceService,
    private readonly sessionState: SessionStateService,
    private readonly locks: LockService,
    private readonly commands: CommandsService,
    private readonly audit: AuditService,
  ) {
    // Sweep every 5s for stations that missed heartbeats past the 15s
    // offline threshold (design doc §4.4) and push status deltas.
    this.sweepTimer = setInterval(() => this.sweepPresence(), 5_000);
    // Re-push a fresh lock:heartbeat to every locked station every 15s
    // (design doc §3.3) — this IS the failsafe: stop this timer (server
    // dead, crashed, or this process torn down) and every locked client
    // self-unlocks within 30s with no unlock code path required.
    this.lockHeartbeatTimer = setInterval(() => this.pushLockHeartbeats(), LOCK_HEARTBEAT_INTERVAL_MS);
  }

  afterInit(server: Server): void {
    // Hands CommandsService the socket server so it can emit without a
    // circular constructor dependency on this gateway (see commands.service.ts).
    this.commands.attachServer(server);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.lockHeartbeatTimer) clearInterval(this.lockHeartbeatTimer);
  }

  async handleConnection(socket: AuthedSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;

    // Try dashboard JWT auth first. A station's placeholder token
    // (design doc: "no station token yet — Phase 1 hardens this to a
    // signed, short-TTL station credential minted at seat assignment")
    // will fail verification here, and that is expected — it falls
    // through to stay connected unauthenticated-as-a-user, identifying
    // itself via station:hello instead. We must NOT disconnect on a
    // failed/missing JWT: that would make it impossible for any station
    // to ever connect, since stations don't hold one yet.
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        socket.data.auth = { kind: 'user', user: payload };
        if (payload.role === 'ADMIN' || payload.role === 'TEACHER') {
          socket.join('dashboards');
          socket.emit('lab:status', await this.stations.listStatusBoard());
        }
      } catch {
        // Not a valid dashboard JWT — leave socket.data.auth unset and
        // wait for station:hello to establish it as a station.
      }
    }
  }

  handleDisconnect(socket: AuthedSocket): void {
    const auth = socket.data.auth;
    if (auth?.kind === 'station') {
      this.presence.remove(auth.stationId);
      this.broadcastStatusDelta(auth.stationId);
    }
  }

  /**
   * A station identifies itself via station:hello rather than the JWT
   * handshake used by dashboards — stations authenticate by a long-lived
   * station credential minted at seat assignment (Phase 1 hardens this;
   * for now the machineGuid itself gates a lookup, matching the "no
   * runtime elevation, no shared secret a student can read" posture for
   * the local agent, applied here to the network credential too).
   */
  @SubscribeMessage('station:hello')
  async handleHello(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: StationHello,
  ): Promise<StationHelloAck> {
    try {
      return await this.doHandleHello(socket, payload);
    } catch (err) {
      // Nest's default WS exception filter only emits a generic
      // "Internal server error" to the client and swallows the real
      // stack trace entirely — with no server-side log, a broken station
      // registration would fail silently. Log it here explicitly so it
      // shows up in the same place every other server error does.
      this.logger.error('handleHello failed', err as Error);
      throw err;
    }
  }

  private async doHandleHello(socket: AuthedSocket, payload: StationHello): Promise<StationHelloAck> {
    const { stationId, seatNo } = await this.stations.register(payload);
    socket.data.auth = { kind: 'station', stationId };

    socket.join(stationRoom(stationId));
    socket.join(ALL_STATIONS_ROOM);

    const forwardedIp = (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    this.presence.upsert({
      stationId,
      seatNo,
      socketId: socket.id,
      appVersion: payload.appVersion,
      osBuild: payload.osBuild,
      ip: forwardedIp ?? socket.handshake.address ?? null,
      lastHeartbeatAt: Date.now(),
      lockState: { screen: false, input: false },
      activityId: null,
    });
    await this.stations.markSeen(stationId, {
      lifecycle: seatNo ? StationLifecycle.READY : StationLifecycle.UNCLAIMED,
      ip: forwardedIp ?? socket.handshake.address,
    });

    const desired = await this.sessionState.getDesiredState(stationId);
    socket.emit('session:snapshot', desired);
    if (seatNo) {
      socket.emit('station:identity', { stationId, seatNo, displayName: `Seat ${seatNo}` });
      socket.join(groupRoom(desired.groupId ?? '__none__'));
      if (desired.sessionId) socket.join(sessionRoom(desired.sessionId));
    }

    this.broadcastStatusDelta(stationId);
    // A station that reconnects mid-outage must not lose a shutdown/
    // launch command that was issued while it was offline.
    this.commands.redeliverPending(stationId, socket.id);

    return { stationId, seatNo, serverTime: Date.now(), snapshotSeq: desired.seq };
  }

  @SubscribeMessage('station:heartbeat')
  handleHeartbeat(@ConnectedSocket() socket: AuthedSocket, @MessageBody() payload: StationHeartbeat): void {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    this.presence.heartbeat(auth.stationId, { lockState: payload.lockState, activityId: payload.activityId });
  }

  @SubscribeMessage('command:ack')
  async handleCommandAck(@ConnectedSocket() socket: AuthedSocket, @MessageBody() ack: CommandAck): Promise<void> {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    this.commands.ack(auth.stationId, ack);
    await this.audit.log({
      stationId: auth.stationId,
      action: `command.ack.${ack.status}`,
      detail: { commandId: ack.commandId, error: ack.error },
    });
  }

  /** Called by other services (Phase 1 SessionsService) to push a fresh snapshot. */
  pushSnapshot(stationId: string, snapshot: Awaited<ReturnType<SessionStateService['getDesiredState']>>): void {
    this.server.to(stationRoom(stationId)).emit('session:snapshot', snapshot);
  }

  broadcastToStation(stationId: string, event: 'command', payload: unknown): void {
    this.server.to(stationRoom(stationId)).emit(event, payload as never);
  }

  private broadcastStatusDelta(stationId: string): void {
    this.server.to('dashboards').emit('lab:status:delta', this.presence.toStatusPatch(stationId));
  }

  private sweepPresence(): void {
    const wentOffline = this.presence.sweepMissedHeartbeats();
    for (const stationId of wentOffline) {
      this.logger.warn(`Station ${stationId} went offline (missed heartbeats)`);
      this.broadcastStatusDelta(stationId);
    }
  }

  private pushLockHeartbeats(): void {
    const expiresAt = Date.now() + 30_000;
    for (const stationId of this.locks.listLockedStationIds()) {
      this.server.to(stationRoom(stationId)).emit('lock:heartbeat', { expiresAt });
    }
  }
}
