import type {
  CommandAck,
  CommandEnvelope,
  DesiredStationState,
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

// ---- Station (client) -> Server --------------------------------------------------

export interface StationToServerEvents {
  'station:hello': (payload: StationHello, ack: (res: StationHelloAck) => void) => void;
  'station:heartbeat': (payload: StationHeartbeat) => void;
  'command:ack': (payload: CommandAck) => void;
  'activity:event': (payload: ActivityEventPayload) => void;
  'interp:selectChannel': (payload: { sessionId: string; trackSid: string }) => void;
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
  /** Relay of another group member's activity:event (Ser 3 mic-request
   * queue, chairman turn-passing). The server is a dumb relay here, not
   * an authority — the CHAIRMAN's own client decides who has the floor
   * and broadcasts it; this is a classroom coordination aid, not a
   * security boundary, so trusting the relay is an acceptable v1 scope
   * cut (see build plan Phase 2 notes). */
  'activity:event': (payload: ActivityEventPayload & { fromStationId: string }) => void;
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
}

// ---- Combined maps for socket.io-client / socket.io generics ---------------------

export type ClientToServerEvents = StationToServerEvents;
export type ServerToClientEvents = ServerToStationEvents & ServerToDashboardEvents;

export * from './media.js';
