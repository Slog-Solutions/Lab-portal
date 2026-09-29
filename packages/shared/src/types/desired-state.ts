import type { ActivityType, CommandType, SessionRole } from './enums.js';
import type { CommandTarget, StationMediaGrant } from './station.js';
import type { RoundTableView } from './round-table.js';
import type { TimedTestState } from './timed-test.js';

/**
 * Declarative, reconciled state (design doc §4.3). The server pushes a
 * snapshot; the client diffs current-vs-desired and converges. This is
 * what makes reconnection and retry nearly free — idempotent by
 * construction, no event-log replay required.
 *
 * `seq` is monotonic per station and guards against reordering when a
 * snapshot arrives out of order (e.g. two pushes racing a reconnect).
 */
export interface DesiredStationState {
  seq: number;
  sessionId: string | null;
  groupId: string | null;
  role: SessionRole | null;
  activity: {
    type: ActivityType;
    instanceId: string;
    /** Activity-specific config, validated against that activity's configSchema. */
    config: unknown;
    /** SPEC-mcq-test-timed-reveal.md §5.3 — set only for a VOCABULARY_TEST
     * instance launched via "Launch in lab" (ActivityInstance.exerciseId is
     * set). Absent for every other activity, and for an older server. */
    timedTest?: TimedTestState | null;
  } | null;
  lock: {
    /** Identifies one Lock click — a re-sent snapshot carries the same id,
     * so the station can tell "still the same lock" from "a brand new
     * Lock" apart (see WorkstationLockController.apply). */
    id: string;
    /** 'soft'    = app overlay + OS input suppression; the teacher's Unlock releases it.
     *  'windows' = real LockWorkStation; only the student's Windows password releases it.
     *  Absent on a snapshot from an older server → treat as 'soft'. */
    mode?: 'soft' | 'windows';
    screen: boolean;
    input: boolean;
    message?: string;
    /** Lease expiry (design doc §3.3) — absence of renewal auto-unlocks. Unix ms. */
    expiresAt: number;
  } | null;
  media: {
    rooms: StationMediaGrant[];
  };
  stationEnabled: boolean;
  /** Visible "you are being viewed/controlled" indicator — default on (see plan decisions). */
  monitoringIndicator: boolean;
  /** Mirrors StationStatusRow.liveClass — lets the student console show
   * "Class: {title} · {teacherName}" without a separate fetch. */
  liveClass: { id: string; title: string; teacherName: string } | null;
  /** Ser 3: floor, queue and roster for a station in a Round Table group.
   * Absent for other stations and for an older server. A reconnecting
   * station renders purely from this — no recovery code. */
  roundTable?: RoundTableView | null;
  /** Offline dictionary (SPEC-offline-dictionary.md §7) — whether the
   * current activity (or no activity) permits dictionary lookups from
   * this seat. Defaults true (see resolveDictionaryEnabled); the server
   * enforces this independently on every /dictionary/* call, so hiding
   * the panel on false is a UX courtesy, not the actual gate. */
  dictionaryEnabled: boolean;
}

export function emptyDesiredState(seq = 0): DesiredStationState {
  return {
    seq,
    sessionId: null,
    groupId: null,
    role: null,
    activity: null,
    lock: null,
    media: { rooms: [] },
    stationEnabled: true,
    monitoringIndicator: true,
    liveClass: null,
    dictionaryEnabled: true,
  };
}

/**
 * Imperative, genuinely one-shot commands (design doc §4.3). Held in a
 * server-side outbox and redelivered until acked or expired. Clients keep
 * a ring buffer of applied commandIds and re-ack duplicates WITHOUT
 * re-executing them.
 */
export interface CommandEnvelope<T = unknown> {
  id: string;
  seq: number;
  type: CommandType;
  target: CommandTarget;
  payload: T;
  issuedAt: number;
  expiresAt: number;
}

export interface CommandAck {
  commandId: string;
  status: 'applied' | 'failed' | 'ignored';
  error?: string;
  appliedAt: number;
}

// ---- Per-command payload shapes -------------------------------------------------

export interface LaunchProgramPayload {
  /** Must match an entry in the server-side allowlist — never an arbitrary string. */
  programId: string;
  args?: string[];
}

export interface OpenUrlPayload {
  url: string;
}

export interface PushFilePayload {
  assetId: string;
  destinationHint: 'desktop' | 'downloads';
}

export interface MessagePayload {
  text: string;
  severity: 'info' | 'warning';
}
