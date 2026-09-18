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
  UserRole,
  seatLabel,
  type CommandAck,
  type StationHeartbeat,
  type StationHello,
  type StationHelloAck,
  type StationStatusRow,
} from '@lab/shared';
import { AuthService, type JwtPayload } from '../auth/auth.service';
import { StationsService } from '../stations/stations.service';
import { AuditService } from '../audit/audit.service';
import { ClassAccessService } from '../classroom/class-access.service';
import { PresenceService } from './presence.service';
import { SessionStateService } from './session-state.service';
import { LockService } from './lock.service';
import { CommandsService } from './commands.service';

const LOCK_HEARTBEAT_INTERVAL_MS = 15_000; // design doc §3.3 — must be < the 30s auto-unlock threshold

/** Per-teacher dashboard room — mirrors 'dashboards' (ADMIN, sees
 * everything) but scoped to one TEACHER's currently controllable
 * stations (see ClassAccessService). */
function dashRoom(teacherId: string): string {
  return `dash:${teacherId}`;
}

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
    private readonly classAccess: ClassAccessService,
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
          if (payload.role === 'ADMIN') {
            socket.join('dashboards');
            socket.emit('lab:status', await this.stations.listStatusBoard());
          } else if (payload.role === 'TEACHER') {
            // A TEACHER only ever sees/controls the stations currently in
            // their own ACTIVE class (design decision: "a teacher sees and
            // controls only the PCs in their active class") — dash:<userId>
            // is this teacher's own room, joined regardless of whether a
            // class is active yet (starting one doesn't reconnect the socket).
            socket.join(dashRoom(payload.sub));
            socket.emit('lab:status', await this.controllableStatusRows(payload));
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
      // Read before remove() — once the presence entry is gone,
      // classTeacherId is gone with it, and the delta below would only
      // ever reach 'dashboards', never the class's own teacher room.
      const classTeacherId = this.presence.get(auth.stationId)?.classTeacherId ?? null;
      this.presence.remove(auth.stationId);
      this.broadcastStatusDelta(auth.stationId, classTeacherId);
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
    const { stationId, seatNo, classTeacherId } = await this.stations.register(payload);
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
      classTeacherId,
    });
    await this.stations.markSeen(stationId, {
      lifecycle: seatNo ? StationLifecycle.READY : StationLifecycle.UNCLAIMED,
      ip: forwardedIp ?? socket.handshake.address,
    });

    const desired = await this.sessionState.getDesiredState(stationId);
    socket.emit('session:snapshot', desired);
    if (seatNo) {
      this.emitIdentity(stationId, seatNo);
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
    const relayPayload = { ...payload, stationId: auth.stationId };
    this.server.to('dashboards').emit('interp:channel', relayPayload);
    const classTeacherId = this.presence.get(auth.stationId)?.classTeacherId;
    if (classTeacherId) this.server.to(dashRoom(classTeacherId)).emit('interp:channel', relayPayload);
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

  /** Used by ClassroomService to tell a station its classroom membership
   * just ended (class ended, or an admin/teacher force-released the seat)
   * — the student console reacts by clearing its local session (see
   * useStudentSession.clear via StudentConsole's onSignedOut wiring). */
  emitToStation(stationId: string, event: 'student:signed-out', payload: { reason: 'class_ended' | 'released' }): void {
    this.server.to(stationRoom(stationId)).emit(event, payload);
  }

  /** Re-announces a station's seat after it changes outside of hello (a
   * classroom sign-in assigns/changes seatNo — see StationsService.claim).
   * `System ${seatLabel(seatNo)}` matches the seat grid's own labelling
   * convention (seat 1 = 'T', everything else = seatNo - 1). */
  emitIdentity(stationId: string, seatNo: number): void {
    this.server.to(stationRoom(stationId)).emit('station:identity', { stationId, seatNo, displayName: `System ${seatLabel(seatNo)}` });
  }

  /** Pushes one station's DB-derived fields (currentUser, liveClass, …)
   * merged with its live presence, to 'dashboards' and — if it's currently
   * in a class — to that class's own dash:<teacherId> room too. Used right
   * after a classroom sign-in so both an admin's full board and the
   * signing-in student's teacher see the change within about a second,
   * without waiting for the next 10s status-board poll. */
  async sendStatusRow(stationId: string): Promise<void> {
    const result = await this.stations.getStatusRow(stationId);
    if (!result) return;
    const merged = this.mergeWithPresence(result.row);
    this.server.to('dashboards').emit('lab:status:delta', merged);
    const teacherId = result.classTeacherId ?? this.presence.get(stationId)?.classTeacherId;
    if (teacherId) this.server.to(dashRoom(teacherId)).emit('lab:status:delta', merged);
  }

  /** Pushes this teacher's full (filtered) board to their own dashboard
   * room — used when a station LEAVES their class (sign-out, class end),
   * since at that point the station's own liveClassId no longer names
   * this teacher, so a single-row sendStatusRow could never reach them. */
  async sendFullStatusToTeacher(teacherId: string): Promise<void> {
    const rows = await this.controllableStatusRows({ sub: teacherId, role: UserRole.TEACHER });
    this.server.to(dashRoom(teacherId)).emit('lab:status', rows);
  }

  private async controllableStatusRows(user: Pick<JwtPayload, 'sub' | 'role'>): Promise<StationStatusRow[]> {
    const rows = (await this.stations.listStatusBoard()).map((row) => this.mergeWithPresence(row));
    const controllable = await this.classAccess.controllableStationIds(user);
    return controllable === 'all' ? rows : rows.filter((r) => controllable.includes(r.stationId));
  }

  /** Same DB-row + live-presence merge ControlController.statusBoard()
   * does over REST — kept here too since the gateway pushes single-row and
   * full-board updates of its own (sendStatusRow/sendFullStatusToTeacher/
   * controllableStatusRows) that must look identical to what a fresh
   * GET /control/status-board would return. */
  private mergeWithPresence(row: StationStatusRow): StationStatusRow {
    const patch = this.presence.toStatusPatch(row.stationId);
    const online = this.presence.isOnline(row.stationId);
    return {
      ...row,
      lifecycle: online ? patch.lifecycle! : StationLifecycle.OFFLINE,
      lock: online ? (patch.lock ?? null) : null,
      lastSeenAt: online ? (patch.lastSeenAt ?? row.lastSeenAt) : row.lastSeenAt,
      ip: online ? (patch.ip ?? row.ip) : row.ip,
    };
  }

  startRemoteControl(stationId: string, room: string, token: string): void {
    this.server.to(stationRoom(stationId)).emit('remote-control:start', { room, token });
  }

  stopRemoteControl(stationId: string, room: string): void {
    this.server.to(stationRoom(stationId)).emit('remote-control:stop', { room });
  }

  private broadcastStatusDelta(stationId: string, classTeacherId?: string | null): void {
    const patch = this.presence.toStatusPatch(stationId);
    this.server.to('dashboards').emit('lab:status:delta', patch);
    const teacherId = classTeacherId ?? this.presence.get(stationId)?.classTeacherId;
    if (teacherId) this.server.to(dashRoom(teacherId)).emit('lab:status:delta', patch);
  }

  private sweepPresence(): void {
    const wentOffline = this.presence.sweepMissedHeartbeats();
    for (const { stationId, classTeacherId } of wentOffline) {
      this.logger.warn(`Station ${stationId} went offline (missed heartbeats)`);
      this.broadcastStatusDelta(stationId, classTeacherId);
    }
  }

  private pushLockHeartbeats(): void {
    const expiresAt = Date.now() + 30_000;
    for (const stationId of this.locks.listLockedStationIds()) {
      this.server.to(stationRoom(stationId)).emit('lock:heartbeat', { expiresAt });
    }
  }
}
