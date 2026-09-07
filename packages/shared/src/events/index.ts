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
}

// ---- Server -> Teacher / Admin dashboards -----------------------------------------

export interface ServerToDashboardEvents {
  'lab:status': (payload: StationStatusRow[]) => void;
  'lab:status:delta': (payload: Partial<StationStatusRow> & { stationId: string }) => void;
  'session:state': (payload: { sessionId: string; state: string; seq: number }) => void;
}

// ---- Combined maps for socket.io-client / socket.io generics ---------------------

export type ClientToServerEvents = StationToServerEvents;
export type ServerToClientEvents = ServerToStationEvents & ServerToDashboardEvents;

export * from './media.js';
