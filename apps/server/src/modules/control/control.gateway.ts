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
import {
  ALL_STATIONS_ROOM,
  CONTROL_NAMESPACE,
  groupRoom,
  sessionRoom,
  stationRoom,
  type ActivityEventPayload,
} from '@lab/shared/events';
import {
  StationLifecycle,
  type CommandAck,
  type StationHeartbeat,
  type StationHello,
  type StationHelloAck,
} from '@lab/shared';
import { AuthService, type JwtPayload } from '../auth/auth.service';
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
    private readonly auth: AuthService,
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

    // Try JWT auth first — either a dashboard user or (Phase 3) a
    // station's own credential minted by a prior station:hello. A first
    // connection ever (no station token minted yet) sends no usable
    // token here and that's expected: it falls through unauthenticated
    // and identifies itself via station:hello instead, which mints one.
    // We must NOT disconnect on a failed/missing JWT — that would make
    // first contact from any station impossible.
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        if (payload.kind === 'station') {
          // Re-establishing an already-known station's identity early
          // isn't load-bearing (station:hello runs next regardless and
          // re-derives everything), but it must be categorized correctly
          // — filing a real station credential under `kind: 'user'` here
          // would silently exclude it from every `auth?.kind === 'station'`
          // check below (heartbeat, command:ack, activity:event) until
          // station:hello re-authenticates it a moment later anyway. This
          // was live for one release with only the placeholder string
          // `'station-unauthenticated-phase1'`, which always failed
          // verification and so never actually hit this branch.
          socket.data.auth = { kind: 'station', stationId: payload.sub };
        } else {
          socket.data.auth = { kind: 'user', user: payload };
          if (payload.role === 'ADMIN' || payload.role === 'TEACHER') {
            socket.join('dashboards');
            socket.emit('lab:status', await this.stations.listStatusBoard());
          }
        }
      } catch {
        // Not a valid JWT of either kind — leave socket.data.auth unset
        // and wait for station:hello to establish it as a station.
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
   * A station identifies itself via station:hello rather than a JWT
   * handshake, because the very first connection ever has no token to
   * present — machineGuid is the durable identity (design doc §3.7), and
   * this call is also where a fresh station-scoped JWT (Phase 3;
   * `StationHelloAck.token`) gets minted and handed back for the
   * station's own subsequent HTTP calls (recordings, attempts).
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
    }
    // Group/session room membership must NOT depend on whether a seat
    // number has been assigned — a station can be a real session member
    // before an admin ever gets around to placing it on the seat map.
    // This was a real bug: any station without an assigned seat could
    // never actually receive activity:event relays or anything else
    // scoped to its group room, even while correctly showing the right
    // role/activity in its own snapshot.
    if (desired.groupId) socket.join(groupRoom(desired.groupId));
    if (desired.sessionId) socket.join(sessionRoom(desired.sessionId));

    this.broadcastStatusDelta(stationId);
    // A station that reconnects mid-outage must not lose a shutdown/
    // launch command that was issued while it was offline.
    this.commands.redeliverPending(stationId, socket.id);

    const token = await this.auth.mintStationToken(stationId);
    return { stationId, seatNo, serverTime: Date.now(), snapshotSeq: desired.seq, token };
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

  /** Relays a group member's activity coordination event (mic-request,
   * chairman turn-passing — Ser 3) to the rest of that group. Deliberately
   * a dumb relay, not an authority: the chairman's own client decides who
   * has the floor. See packages/shared/src/events/index.ts's comment on
   * why this is an acceptable v1 scope cut. */
  @SubscribeMessage('activity:event')
  handleActivityEvent(@ConnectedSocket() socket: AuthedSocket, @MessageBody() payload: ActivityEventPayload): void {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    this.server.to(groupRoom(payload.groupId)).emit('activity:event', { ...payload, fromStationId: auth.stationId });
  }

  /**
   * Ser 8 Conference Interpreting (Phase 5): a participant reports which
   * published track (the floor, or a specific interpreter's language
   * channel) it just switched its own LiveKit subscription to. This is
   * observational, not authoritative — the participant's own client
   * already decided the subscription via its room-scoped canSubscribe
   * grant (MediaService.mintInterpretingToken) before this event ever
   * arrives; relaying it to `dashboards` only lets a teacher's monitoring
   * UI show who is listening to whom, the same "dumb relay, not a
   * security boundary" posture activity:event already documents.
   */
  @SubscribeMessage('interp:selectChannel')
  async handleInterpSelectChannel(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() payload: { sessionId: string; trackSid: string },
  ): Promise<void> {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    this.server.to('dashboards').emit('interp:channel', { ...payload, stationId: auth.stationId });
    await this.audit.log({ stationId: auth.stationId, action: 'interp.select_channel', detail: payload });
  }

  /**
   * Called by other services (SessionsService/ControlController) to push
   * a fresh snapshot. Also (re)joins the socket to the group/session
   * rooms named in the new snapshot — group membership was previously
   * only ever set once, at station:hello, so a station assigned to a
   * group AFTER it had already connected (the normal case: sessions are
   * armed after stations power on) would never actually be in
   * groupRoom(...), silently breaking anything that relays through it
   * (activity:event — mic-request/chairman relay). `socketsJoin` is
   * idempotent. Known simplification: a station moved OUT of a group
   * while still connected keeps its old group-room membership (no
   * corresponding leave) — acceptable for this phase; a station
   * reconnecting always gets a clean room set from station:hello.
   */
  pushSnapshot(stationId: string, snapshot: Awaited<ReturnType<SessionStateService['getDesiredState']>>): void {
    this.server.to(stationRoom(stationId)).emit('session:snapshot', snapshot);
    if (snapshot.groupId) this.server.in(stationRoom(stationId)).socketsJoin(groupRoom(snapshot.groupId));
    if (snapshot.sessionId) this.server.in(stationRoom(stationId)).socketsJoin(sessionRoom(snapshot.sessionId));
  }

  broadcastToStation(stationId: string, event: 'command', payload: unknown): void {
    this.server.to(stationRoom(stationId)).emit(event, payload as never);
  }

  startRemoteControl(stationId: string, room: string, token: string): void {
    this.server.to(stationRoom(stationId)).emit('remote-control:start', { room, token });
  }

  stopRemoteControl(stationId: string, room: string): void {
    this.server.to(stationRoom(stationId)).emit('remote-control:stop', { room });
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
