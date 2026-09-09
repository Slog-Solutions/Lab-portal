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

/**
 * Phase 5: the one place that decides which physical LiveKit room a
 * group's activity actually lives in — used identically by
 * SessionsService (arm/end, room create/delete) and SessionStateService
 * (per-station token minting), so the two can never disagree about a
 * room name the way `groupMediaRoom` alone would invite if one call site
 * special-cased conference interpreting and the other forgot to.
 * Conference interpreting is session-wide by design (Annexure-I Ser 8: a
 * shared floor + per-language interpreter channels everyone in the
 * session can select between), not per-group like every other activity.
 */
export function mediaRoomForActivity(sessionId: string, groupId: string, activityType: string): string {
  return activityType === 'CONFERENCE_INTERPRETING' ? interpretingRoom(sessionId) : groupMediaRoom(sessionId, groupId);
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
  // Phase 1's replay path is @nut-tree-fork/nut-js (design doc §3.4's
  // "zero build risk" option), whose keyboard API takes its own `Key`
  // enum — not a raw Win32 scan code. `keyName` is a `Key` enum member
  // name (e.g. "A", "Escape", "LeftControl") so the wire format doesn't
  // depend on nut.js's numeric enum values staying stable across
  // versions. A later native-bridge hook-based replay (blocked — no C++
  // toolchain, see build plan) would need its own scanCode mapping;
  // that is a receiver-side concern, not a wire-format change.
  | { kind: 'key'; keyName: string; down: boolean }
  | { kind: 'text'; unicodeChar: string };
