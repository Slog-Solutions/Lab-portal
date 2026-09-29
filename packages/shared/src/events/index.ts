import type {
  CommandAck,
  CommandEnvelope,
  DesiredStationState,
  RoundTableFloor,
  StationHeartbeat,
  StationHello,
  StationHelloAck,
  StationStatusRow,
} from '../types/index.js';

/**
 * Typed Socket.IO contract for the `/control` namespace (design doc §4.1–4.4).
 *
 * Control is deliberately a SEPARATE connection from LiveKit media — it must
 * survive media being down, since the unlock failsafe (design doc §3.3)
 * cannot depend on WebRTC. The only exception is remote-control input
 * replay, which travels over a LiveKit data channel because it is
 * high-rate and meaningless without the video track it accompanies.
 */

export const CONTROL_NAMESPACE = '/control';

/** Socket.IO rooms every station socket joins, used for command targeting. */
export function stationRoom(stationId: string): string {
  return `st:${stationId}`;
}
export function sessionRoom(sessionId: string): string {
  return `sess:${sessionId}`;
}
export function groupRoom(groupId: string): string {
  return `grp:${groupId}`;
}
export const ALL_STATIONS_ROOM = 'all';

/** Teacher dashboards watching one session's Round Table floors join this
 * room (see RoundTableGateway 'rt:watch'). */
export function roundTableDashRoom(sessionId: string): string {
  return `rt:${sessionId}`;
}

/** Every teacher/admin dashboard socket joins this room so lab-wide status
 * deltas (including unseated stations, which have no `liveClass` and so
 * never route through a `dash:<teacherId>` room) reach every dashboard. */
export const ALL_DASHBOARDS_ROOM = 'dash:all';

/** A teacher's own classroom broadcast room — scoped to the students
 * currently signed into that LiveClass, distinct from the lab-wide
 * BROADCAST_ROOM an ADMIN uses (see MediaController.broadcastToken and
 * SessionStateService.getDesiredState). */
export function classBroadcastRoom(classId: string): string {
  return `class:${classId}:broadcast`;
}

// ---- Station (client) -> Server --------------------------------------------------

export interface StationToServerEvents {
  'station:hello': (payload: StationHello, ack: (res: StationHelloAck) => void) => void;
  'station:heartbeat': (payload: StationHeartbeat) => void;
  'command:ack': (payload: CommandAck) => void;
  'activity:event': (payload: ActivityEventPayload) => void;
  'interp:selectChannel': (payload: { sessionId: string; trackSid: string }) => void;
  // ---- Ser 3 Round Table. The server owns the floor; the caller's identity is
  // always the authenticated station socket, never a stationId in the payload.
  'rt:requestMic': (payload: RtGroupRef) => void;
  'rt:cancelRequest': (payload: RtGroupRef) => void;
  /** Chairman only. `stationId` is the grant TARGET, not the caller. */
  'rt:grantFloor': (payload: RtGroupRef & { stationId: string }) => void;
  /** Chairman only. */
  'rt:revokeFloor': (payload: RtGroupRef) => void;
  /** The current speaker only. */
  'rt:yieldFloor': (payload: RtGroupRef) => void;
  /** Sent after (re)joining the group's LiveKit room so the server applies
   * this seat's publish permission immediately. */
  'rt:sync': (payload: RtGroupRef) => void;
  /** The chairman's own voice activity — the chairman talks continuously, so
   * their turns come from speech, not floor state. Server-stamped. */
  'rt:chairSpeaking': (payload: RtGroupRef & { speaking: boolean }) => void;
}

export interface RtGroupRef {
  sessionId: string;
  groupId: string;
}

export interface ActivityEventPayload {
  sessionId: string;
  groupId: string;
  type: 'mic_request' | 'chairman_pass' | 'answer_submit' | 'pause' | 'resume' | string;
  payload: unknown;
}

// ---- Server -> Station (client) ---------------------------------------------------

export interface ServerToStationEvents {
  'session:snapshot': (payload: DesiredStationState) => void;
  command: (payload: CommandEnvelope) => void;
  'station:identity': (payload: { stationId: string; seatNo: number; displayName: string }) => void;
  'lock:heartbeat': (payload: { expiresAt: number }) => void;
  /** Teacher started remote control (design doc §3.4) — the station
   * publishes its screen into `ctrl:<stationId>` using this token and
   * begins listening for input-replay data on that room's data channel. */
  'remote-control:start': (payload: { room: string; token: string }) => void;
  'remote-control:stop': (payload: { room: string }) => void;
  /** Relay of another group member's activity:event. Round Table (Ser 3)
   * NO LONGER uses this — its floor is server-authoritative, see the rt:*
   * events. Other activities keep this as a dumb relay: a classroom
   * coordination aid, not a security boundary. */
  'activity:event': (payload: ActivityEventPayload & { fromStationId: string }) => void;
  /** An admin/teacher force-released this seat, or the station released
   * itself. The student console clears its local session and returns to
   * the sign-in screen (see useStudentSession.clear and StudentConsole's
   * onSignedOut wiring). A class simply ENDING does NOT fire this — the
   * student stays signed in and only loses the broadcast (a fresh
   * session:snapshot with no liveClass covers that). */
  'student:signed-out': (payload: { reason: 'released' }) => void;
  /** Teacher spotlight (Ser 1 "broadcast any student's screen to others").
   * Deliberately declarative and idempotent rather than a start/stop pair:
   * it also carries the presenter-mic toggle, so a mic change mid-spotlight
   * can't race a stop. Unlike remote-control:start this carries NO token —
   * the station is already connected to `room` with a live grant, and the
   * server upgraded its publish permissions in place via
   * MediaService.promoteScreenShare before emitting. {screen:false,mic:false}
   * means "stop". */
  'screen-share:set': (payload: { room: string; screen: boolean; mic: boolean }) => void;
  /** Authoritative Round Table floor for the group. Drop any update whose
   * `seq` is lower than the one already shown. */
  'rt:floor': (payload: RoundTableFloor) => void;
  /** A rejected Round Table action (not your turn, not chairman, ...). */
  'rt:error': (payload: { groupId: string; message: string }) => void;
  /** SPEC-mcq-test-timed-reveal.md §5.4 — the teacher moved `closesAt`
   * (Extend, or the close scheduler just closed it). A hint only: the
   * authoritative value is always the next `session:snapshot`'s
   * `activity.timedTest.closesAt` — a station that missed this event (or
   * reconnected after it) still converges correctly. */
  'test:closing': (payload: { activityInstanceId: string; closesAt: number; serverNow: number }) => void;
  /** The close sequence finished revealing this instance's results —
   * fetch/refetch `GET /attempts/:id/result` now. */
  'test:revealed': (payload: { activityInstanceId: string }) => void;
}

// ---- Server -> Teacher / Admin dashboards -----------------------------------------

export interface ServerToDashboardEvents {
  'lab:status': (payload: StationStatusRow[]) => void;
  'lab:status:delta': (payload: Partial<StationStatusRow> & { stationId: string }) => void;
  'session:state': (payload: { sessionId: string; state: string; seq: number }) => void;
  /** Phase 5 — relay of a participant's interp:selectChannel so a
   * teacher's monitoring UI can show who is currently listening to whom.
   * Purely observational, same "dumb relay" posture as activity:event —
   * the client already holds canSubscribe:true for the whole interpreting
   * room, so this changes nothing about what a participant can hear. */
  'interp:channel': (payload: { sessionId: string; stationId: string; trackSid: string }) => void;
  'rt:floor': (payload: RoundTableFloor) => void;
  'rt:alert': (payload: { sessionId: string; groupId: string; kind: 'chairman_offline' | 'chairman_promoted'; stationId: string }) => void;
}

// ---- Teacher / Admin dashboards -> Server -------------------------------------------

export interface DashboardToServerEvents {
  /** Subscribe to every Round Table group's floor in one session. */
  'rt:watch': (payload: { sessionId: string }) => void;
  'rt:unwatch': (payload: { sessionId: string }) => void;
}

// ---- Combined maps for socket.io-client / socket.io generics ---------------------

export type ClientToServerEvents = StationToServerEvents & DashboardToServerEvents;
export type ServerToClientEvents = ServerToStationEvents & ServerToDashboardEvents;

export * from './media.js';
