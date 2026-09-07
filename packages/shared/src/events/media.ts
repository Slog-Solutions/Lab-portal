/**
 * LiveKit room-naming conventions (design doc §2.2–2.3). Centralised so the
 * server, web and desktop never hand-format a room name differently.
 */

/** Plane A — permanent, all 41 stations joined. Teacher screen broadcast, class intercom. */
export const BROADCAST_ROOM = 'lab:broadcast';

/** Plane B — one room per session group. Isolation is the JWT `room` grant. */
export function groupMediaRoom(sessionId: string, groupId: string): string {
  return `sess:${sessionId}:grp:${groupId}`;
}

/** Conference interpreting room for a session (design doc §2.3). */
export function interpretingRoom(sessionId: string): string {
  return `sess:${sessionId}:interp`;
}

/** Ephemeral 1:1 telephone-activity room. */
export function telephoneRoom(callId: string): string {
  return `call:${callId}`;
}

/** Ephemeral remote-control room — only the teacher holds a token for it. */
export function controlRoom(stationId: string): string {
  return `ctrl:${stationId}`;
}

/** Track name convention for the interpreting activity's floor channel. */
export const INTERPRETING_FLOOR_TRACK = 'floor';

/** Track name convention for an interpreter's language channel. */
export function interpreterTrackName(langCode: string): string {
  return `interp:${langCode}`;
}

export interface InterpretingParticipantMetadata {
  role: 'INTERPRETER' | 'DELEGATE' | 'OBSERVER';
  lang?: string;
}

/** Data-channel topic for remote-control input replay (design doc §3.4). */
export const REMOTE_CONTROL_DATA_TOPIC = 'input';

export type RemoteInputEvent =
  | { kind: 'move'; x: number; y: number } // normalized 0..1, unreliable delivery
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right' | 'middle'; down: boolean }
  | { kind: 'scroll'; deltaX: number; deltaY: number }
  | { kind: 'key'; scanCode: number; down: boolean }
  | { kind: 'text'; unicodeChar: string };
