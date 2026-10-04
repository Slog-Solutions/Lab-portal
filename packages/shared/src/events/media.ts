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

// ---- Live machine translation (SeamlessStreaming) --------------------------

/**
 * Track name for one machine-translated audio channel in a class
 * broadcast room. Deliberately a DIFFERENT prefix from
 * `interpreterTrackName`'s `interp:` — a human interpreter channel and a
 * machine one must never be confused by a client picking a channel, and
 * the student console filters its subscriptions on this prefix.
 */
export function translationTrackName(langCode: string): string {
  return `tr:${langCode}`;
}

/** Parses `tr:<lang>` back to its language code; null for any other name. */
export function parseTranslationTrackName(trackName: string): string | null {
  return trackName.startsWith('tr:') ? trackName.slice(3) : null;
}

/**
 * Identity prefix for the translator service's own LiveKit participant.
 * Same convention as the teacher's `st:teacher:<sub>` (see
 * MediaService.mintToken): a real station's id is a cuid and can never
 * collide. The service is NOT hidden — students must see its tracks to
 * subscribe to them.
 */
export const TRANSLATOR_IDENTITY_PREFIX = 'svc:translator:';

export function translatorIdentity(scopeId: string): string {
  return `${TRANSLATOR_IDENTITY_PREFIX}${scopeId}`;
}

export function isTranslatorIdentity(identity: string): boolean {
  return identity.startsWith(TRANSLATOR_IDENTITY_PREFIX);
}

/** Data-channel topic carrying TranslationCaption payloads (JSON). */
export const TRANSLATION_CAPTIONS_TOPIC = 'tr:captions';

/** Ephemeral room for a Translation Lab test run (teacher-only). */
export function translationTestRoom(runId: string): string {
  return `trtest:${runId}`;
}

/** Track name for the original, untranslated audio in a test room. */
export const TRANSLATION_SOURCE_TRACK = 'src';

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
