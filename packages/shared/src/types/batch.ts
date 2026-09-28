import type { ActivityType, AttemptStatus, RecordingKind, SessionRole, SessionState } from './enums.js';
import type { ClassRecordingHistoryEntry } from './recording.js';

/** One row of GET /batches/mine — the caller's own classes (taught or
 * enrolled). `joinKey` is present ONLY for TEACHER/ADMIN callers; a
 * STUDENT-role response never carries the property at all. */
export interface MyBatchView {
  id: string;
  code: string;
  name: string;
  joinOpen: boolean;
  teacherNames: string[];
  studentCount: number;
  joinKey?: string;
}

/** One live activity (a session group) the student took part in. */
export interface ClassActivityEntry {
  sessionId: string;
  sessionTitle: string;
  sessionState: SessionState;
  /** When the session started, or was created if it never did. ISO string. */
  date: string;
  groupIndex: number;
  activityType: ActivityType;
  activityLabel: string;
  /** Round Table / Interpreting topic or Telephone scenario, when set. */
  topic: string | null;
  role: SessionRole;
  /** The other students in the same group (seats with nobody signed in are left out). */
  groupmates: string[];
  /** This student's own recordings from the activity. */
  recordings: Array<{ id: string; kind: RecordingKind; status: string; durationMs: number | null; createdAt: string }>;
  /** Round Table only: this student's turns on the floor. */
  roundTable: { turns: number; speakingMs: number } | null;
}

/** One assignment the teacher created from this class. */
export interface ClassAssignmentEntry {
  assignmentId: string;
  title: string;
  type: ActivityType;
  typeLabel: string;
  dueAt: string | null;
  createdAt: string;
  latestAttempt: {
    status: AttemptStatus;
    /** 0-100, the teacher's override when there is one. Null until scored. */
    percent: number | null;
    submittedAt: string | null;
    feedback: string | null;
  } | null;
}

/** GET /batches/:id/my-activity — everything a student did in one class. */
export interface ClassHistoryView {
  class: { id: string; code: string; name: string; teacherNames: string[] };
  /** Newest first. */
  activities: ClassActivityEntry[];
  /** Newest first. */
  assignments: ClassAssignmentEntry[];
  /** Recordings the teacher made of the whole class broadcast (not a
   * per-student activity take) — same rows for every student in the
   * class. Newest first. */
  classRecordings: ClassRecordingHistoryEntry[];
}
