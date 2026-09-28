/**
 * Core enums shared across server, web and desktop.
 * Mirrors the Prisma schema's enums 1:1 — keep them in sync by hand
 * (Prisma enums are generated into apps/server/generated/prisma, which
 * apps/web and apps/desktop must never import from directly).
 */

export const UserRole = {
  ADMIN: 'ADMIN',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Lifecycle of a physical seat, as tracked by the server. */
export const StationLifecycle = {
  /** Registered itself but no admin has assigned a seat number yet. */
  UNCLAIMED: 'UNCLAIMED',
  OFFLINE: 'OFFLINE',
  JOINING: 'JOINING',
  READY: 'READY',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  ERROR: 'ERROR',
} as const;
export type StationLifecycle = (typeof StationLifecycle)[keyof typeof StationLifecycle];

/** Server-authoritative session state machine (see design doc §4.5). */
export const SessionState = {
  DRAFT: 'DRAFT',
  ARMED: 'ARMED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
  ABANDONED: 'ABANDONED',
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

/** A student/teacher's role within one SessionGroup (Annexure-I Ser 3, 8). */
export const SessionRole = {
  MEMBER: 'MEMBER',
  CHAIRMAN: 'CHAIRMAN',
  INTERPRETER: 'INTERPRETER',
  DELEGATE: 'DELEGATE',
  OBSERVER: 'OBSERVER',
} as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

/**
 * Activity Type Registry keys. Each maps to one module under
 * packages/shared/src/activities/ — adding an activity is one file,
 * not a schema migration. See design doc "Activity Type Registry".
 */
export const ActivityType = {
  MODEL_IMITATION: 'MODEL_IMITATION',
  ROUND_TABLE: 'ROUND_TABLE',
  CONTENT_EXERCISE: 'CONTENT_EXERCISE',
  VOCABULARY_TEST: 'VOCABULARY_TEST',
  TELEPHONE: 'TELEPHONE',
  PRONUNCIATION: 'PRONUNCIATION',
  PRONUNCIATION_TEST: 'PRONUNCIATION_TEST',
  WRITING_TEST: 'WRITING_TEST',
  LISTENING_TEST: 'LISTENING_TEST',
  READING_TEST: 'READING_TEST',
  CONFERENCE_INTERPRETING: 'CONFERENCE_INTERPRETING',
  PRESENTATION_RECORDING: 'PRESENTATION_RECORDING',
  SELF_STUDY: 'SELF_STUDY',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const MediaAssetScope = {
  PRIVATE: 'PRIVATE',
  DEPARTMENT: 'DEPARTMENT',
  INSTITUTION: 'INSTITUTION',
} as const;
export type MediaAssetScope = (typeof MediaAssetScope)[keyof typeof MediaAssetScope];

export const RecordingKind = {
  MODEL_IMITATION: 'MODEL_IMITATION',
  GROUP_DISCUSSION: 'GROUP_DISCUSSION',
  PRESENTATION: 'PRESENTATION',
  INTERPRETATION: 'INTERPRETATION',
  PRONUNCIATION: 'PRONUNCIATION',
  /** A teacher's own recording of their class broadcast — see ClassRecordingView. */
  CLASS_BROADCAST: 'CLASS_BROADCAST',
} as const;
export type RecordingKind = (typeof RecordingKind)[keyof typeof RecordingKind];

/** Imperative one-shot commands — see DesiredStationState vs CommandEnvelope split. */
export const CommandType = {
  SHUTDOWN: 'SHUTDOWN',
  RESTART: 'RESTART',
  WAKE: 'WAKE',
  LAUNCH_PROGRAM: 'LAUNCH_PROGRAM',
  OPEN_URL: 'OPEN_URL',
  PUSH_FILE: 'PUSH_FILE',
  MESSAGE: 'MESSAGE',
  APPLY_UPDATE: 'APPLY_UPDATE',
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export const CommandAckStatus = {
  APPLIED: 'applied',
  FAILED: 'failed',
  IGNORED: 'ignored',
} as const;
export type CommandAckStatus = (typeof CommandAckStatus)[keyof typeof CommandAckStatus];

/**
 * These four are deliberately plain `String` columns in Prisma (see
 * schema.prisma comments) rather than Postgres enums, so a new value never
 * needs a migration — but the values themselves are still a closed set in
 * practice, so mirror them here for type safety the same way the Prisma
 * enums above are mirrored.
 */
export const ContentPackageFormat = {
  SCORM12: 'SCORM12',
  SCORM2004: 'SCORM2004',
  XAPI: 'XAPI',
  HTML: 'HTML',
} as const;
export type ContentPackageFormat = (typeof ContentPackageFormat)[keyof typeof ContentPackageFormat];

export const ItemType = {
  MCQ: 'MCQ',
  SHORT_ANSWER: 'SHORT_ANSWER',
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const AttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  SCORED: 'SCORED',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const RecordingStatus = {
  PENDING: 'pending',
  RECORDING: 'recording',
  FINALIZING: 'finalizing',
  READY: 'ready',
  FAILED: 'failed',
} as const;
export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

/** `MediaAsset.kind` / upload classification. */
export const AssetKind = {
  AUDIO: 'audio',
  VIDEO: 'video',
  TEXT: 'text',
  IMAGE: 'image',
} as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

/** `Enrollment.source` — plain String column, same reasoning as the group
 * above: a new provenance value never needs a migration. */
export const EnrollmentSource = {
  ADMIN: 'ADMIN',
  SELF_JOIN: 'SELF_JOIN',
} as const;
export type EnrollmentSource = (typeof EnrollmentSource)[keyof typeof EnrollmentSource];

/** Machine-readable `code` carried in the body of a batch-join failure, so a
 * client can pick its own wording instead of parsing prose. The unknown-code
 * and wrong-key cases deliberately share JOIN_INVALID — see
 * BatchesService.joinByCode. */
export const BatchErrorCode = {
  JOIN_INVALID: 'BATCH_JOIN_INVALID',
  JOIN_CLOSED: 'BATCH_JOIN_CLOSED',
} as const;
export type BatchErrorCode = (typeof BatchErrorCode)[keyof typeof BatchErrorCode];
