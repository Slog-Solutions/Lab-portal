import { z } from 'zod';
import { ActivityType, AssetKind, ContentPackageFormat, ItemType, MediaAssetScope, SessionRole, UserRole } from '../types/enums.js';

/**
 * Zod schemas for validated boundaries: HTTP DTOs and the payloads carried
 * inside DesiredStationState.activity.config / CommandEnvelope.payload.
 * These are the runtime-checked counterparts of the plain TS interfaces in
 * ../types — keep both in sync by hand; there is deliberately no
 * schema-to-type codegen step yet (adds build complexity this project
 * doesn't need at its current size).
 */

export const zUserRole = z.enum([UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT]);
export const zSessionRole = z.enum([
  SessionRole.MEMBER,
  SessionRole.CHAIRMAN,
  SessionRole.INTERPRETER,
  SessionRole.DELEGATE,
  SessionRole.OBSERVER,
]);
export const zActivityType = z.enum([
  ActivityType.MODEL_IMITATION,
  ActivityType.ROUND_TABLE,
  ActivityType.CONTENT_EXERCISE,
  ActivityType.VOCABULARY_TEST,
  ActivityType.TELEPHONE,
  ActivityType.PRONUNCIATION,
  ActivityType.CONFERENCE_INTERPRETING,
  ActivityType.PRESENTATION_RECORDING,
  ActivityType.SELF_STUDY,
]);

// ---- Auth --------------------------------------------------------------------

export const zLoginDto = z.object({
  serviceNumber: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
});
export type LoginDto = z.infer<typeof zLoginDto>;

// ---- Station registration (design doc §3.7) -----------------------------------

export const zStationRegisterDto = z.object({
  machineGuid: z.string().uuid(),
  hostname: z.string().min(1).max(64),
  macs: z.array(z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)).min(1),
  appVersion: z.string().min(1).max(32),
  osBuild: z.string().min(1).max(32),
});
export type StationRegisterDto = z.infer<typeof zStationRegisterDto>;

export const zStationAssignSeatDto = z.object({
  stationId: z.string().cuid2(),
  seatNo: z.number().int().min(1).max(41),
});
export type StationAssignSeatDto = z.infer<typeof zStationAssignSeatDto>;

// A classroom sign-in at a seat: real student credentials (see
// StationsService.claim's doc comment for how this replaced the original
// passwordless roster pick), PLUS the two fields that make this a real
// classroom rather than a bare login — systemNumber is the number written
// on the PC's own screen and becomes that station's seat number with no
// admin step (StationsService.claim resolves it via
// seatNoFromSystemNumber), and classCode puts the student into whichever
// teacher started that class (ClassroomService.start). Both are required:
// there is no sign-in without an active class.
export const zClaimStationDto = z.object({
  serviceNumber: z.string().min(3).max(32),
  password: z.string().min(1),
  systemNumber: z.number().int().min(1).max(40),
  classCode: z.string().trim().min(1).max(12),
});
export type ClaimStationDto = z.infer<typeof zClaimStationDto>;

/** POST /classroom/start — title is optional and defaults to "<teacher>'s
 * class" (ClassroomService.start); the code itself is server-generated,
 * never chosen by the teacher. */
export const zStartClassDto = z.object({
  title: z.string().trim().max(80).optional(),
});
export type StartClassDto = z.infer<typeof zStartClassDto>;

// ---- Sessions / groups (design doc §4.5) ---------------------------------------

export const zCreateGroupDto = z.object({
  index: z.number().int().min(1).max(6),
  activityType: zActivityType,
  activityConfig: z.unknown(),
  memberStationIds: z.array(z.string().cuid2()).min(1).max(40),
  chairmanStationId: z.string().cuid2().optional(),
});
export type CreateGroupDto = z.infer<typeof zCreateGroupDto>;

export const zCreateSessionDto = z.object({
  title: z.string().min(1).max(120),
  batchId: z.string().cuid2(),
  groups: z.array(zCreateGroupDto).min(1).max(6),
});
export type CreateSessionDto = z.infer<typeof zCreateSessionDto>;

// ---- Vocabulary test / item bank (Ser 5, Ser 10) --------------------------------

export const zVocabularyItem = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  choices: z.array(z.string()).min(2).max(6).optional(),
});

// Two modes: authored inline (simple, self-contained in the config the
// student's client already holds) or sampled from an ItemBank (Ser 10
// "large test bank... different set of questions each attempt" — grading
// for this path is necessarily server-side, since the config a student
// receives must never carry the answer key for un-served items).
export const zVocabularyTestConfig = z
  .object({
    itemBankId: z.string().cuid2().optional(),
    sampleSize: z.number().int().positive().optional(),
    items: z.array(zVocabularyItem).optional(),
    shuffleItems: z.boolean().default(true),
    timeLimitSec: z.number().int().positive().optional(),
  })
  .refine((cfg) => Boolean(cfg.itemBankId) || (cfg.items?.length ?? 0) > 0, {
    message: 'Either itemBankId (with sampleSize) or a non-empty items[] is required',
    path: ['items'],
  });
export type VocabularyTestConfig = z.infer<typeof zVocabularyTestConfig>;

// ---- Assignment (Ser 10 "tailored courses") -------------------------------------

export const zAssignmentDto = z.object({
  studentIds: z.array(z.string().cuid2()).min(1),
  exerciseIds: z.array(z.string().cuid2()).min(1),
  targetScore: z.number().min(0).max(100).optional(),
  allocatedHours: z.number().positive().optional(),
  dueAt: z.coerce.date().optional(),
});
export type AssignmentDto = z.infer<typeof zAssignmentDto>;

// ---- Score override (Ser 4 — teachers must be able to edit scores) -------------

export const zScoreOverrideDto = z.object({
  attemptId: z.string().cuid2(),
  newScore: z.number().min(0).max(100),
  reason: z.string().min(1).max(500),
});
export type ScoreOverrideDto = z.infer<typeof zScoreOverrideDto>;

// ---- Media library (Ser 1 "media library... multi-teacher sharing") ------------

export const zMediaAssetScope = z.enum([MediaAssetScope.PRIVATE, MediaAssetScope.DEPARTMENT, MediaAssetScope.INSTITUTION]);

/** Metadata carried alongside the multipart upload (query/form fields —
 * the file itself isn't representable in zod, so this validates everything
 * except the binary). */
export const zUploadMediaAssetDto = z.object({
  kind: z.enum([AssetKind.AUDIO, AssetKind.VIDEO, AssetKind.TEXT, AssetKind.IMAGE]),
  title: z.string().min(1).max(200).optional(),
  scope: zMediaAssetScope.default(MediaAssetScope.PRIVATE),
});
export type UploadMediaAssetDto = z.infer<typeof zUploadMediaAssetDto>;

export const zUpdateMediaAssetDto = z.object({
  title: z.string().min(1).max(200).optional(),
  scope: zMediaAssetScope.optional(),
});
export type UpdateMediaAssetDto = z.infer<typeof zUpdateMediaAssetDto>;

// ---- Content package import (SCORM/xAPI/HTML — build plan "engine + import") ---

export const zContentPackageFormat = z.enum([
  ContentPackageFormat.SCORM12,
  ContentPackageFormat.SCORM2004,
  ContentPackageFormat.XAPI,
  ContentPackageFormat.HTML,
]);

export const zImportContentPackageDto = z.object({
  title: z.string().min(1).max(200),
  format: zContentPackageFormat,
  scope: zMediaAssetScope.default(MediaAssetScope.INSTITUTION),
});
export type ImportContentPackageDto = z.infer<typeof zImportContentPackageDto>;

// ---- Exercises / item bank (Ser 4, Ser 5, Ser 10) -------------------------------

export const zCreateExerciseDto = z.object({
  type: zActivityType,
  title: z.string().min(1).max(200),
  lessonId: z.string().cuid2().optional(),
  config: z.unknown(), // validated against that type's configSchema server-side (Activity Type Registry)
});
export type CreateExerciseDto = z.infer<typeof zCreateExerciseDto>;

export const zUpdateExerciseDto = z.object({
  title: z.string().min(1).max(200).optional(),
  config: z.unknown().optional(),
});
export type UpdateExerciseDto = z.infer<typeof zUpdateExerciseDto>;

export const zImportWordListTextDto = z.object({
  text: z.string().min(1),
  append: z.boolean().default(false),
});
export type ImportWordListTextDto = z.infer<typeof zImportWordListTextDto>;

export const zItemType = z.enum([ItemType.MCQ, ItemType.SHORT_ANSWER]);

export const zItemDto = z.object({
  type: zItemType.default(ItemType.SHORT_ANSWER),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  // Phase 4 finding: GET :id/items -> PUT :id/items (the teacher-facing
  // "edit an existing item bank" round trip) was a real 400 waiting to
  // happen for any item with no choices/cefrTag/mediaAssetId set — Prisma
  // serializes an unset scalar-list column as `[]`, never an absent key,
  // and an unset nullable column as `null`, never `undefined`, but these
  // were `.optional()` only (undefined-only). Caught live wiring
  // Item.mediaAssetId through to VocabularyTestPlayer's new listening-item
  // playback: fetching a real seeded item bank and re-PUTting it
  // unmodified rejected with exactly this shape of error.
  choices: z.preprocess((v) => (Array.isArray(v) && v.length === 0 ? undefined : v), z.array(z.string()).min(2).max(6).optional()),
  cefrTag: z.preprocess((v) => v ?? undefined, z.string().max(8).optional()),
  mediaAssetId: z.preprocess((v) => v ?? undefined, z.string().cuid2().optional()),
});
export type ItemDto = z.infer<typeof zItemDto>;

/** Manual bulk entry — one call replaces the whole bank's item list. */
export const zSetItemBankDto = z.object({
  items: z.array(zItemDto).min(1),
});
export type SetItemBankDto = z.infer<typeof zSetItemBankDto>;

/** Word-list import: CSV/TSV or newline-delimited `prompt=answer[,choice1|choice2]`
 * text, parsed server-side — this DTO carries the already-parsed rows so
 * the parsing itself can be unit-tested independent of upload transport. */
export const zImportWordListDto = z.object({
  items: z.array(zItemDto).min(1),
  append: z.boolean().default(false),
});
export type ImportWordListDto = z.infer<typeof zImportWordListDto>;

// ---- Attempts (Ser 4, Ser 5, Ser 7, Ser 10 — every graded/self-study activity) --

export const zStartAttemptDto = z.object({
  exerciseId: z.string().cuid2(),
  assignmentId: z.string().cuid2().optional(),
  activityInstanceId: z.string().cuid2().optional(),
});
export type StartAttemptDto = z.infer<typeof zStartAttemptDto>;

export const zItemResponseDto = z.object({
  // A real Item.id (cuid2) for bank-sourced items, or the "inline:<index>"
  // placeholder AttemptsService.prepareServe hands out for manually
  // authored inline items (which have no Item row — see
  // zVocabularyTestConfig's comment on the two serving modes). Not a
  // strict cuid2: AttemptsService itself is the actual authority that
  // matches this against the attempt's own itemOrder snapshot.
  itemId: z.string().min(1),
  given: z.string(),
  timeSpentMs: z.number().int().nonnegative().optional(),
});
export type ItemResponseDto = z.infer<typeof zItemResponseDto>;

/** Submits the whole attempt in one call — the activity's response
 * payload (validated against its ActivityDescriptor.responseSchema) plus,
 * for item-bank-backed activities, the per-item answers to grade. */
export const zSubmitAttemptDto = z.object({
  response: z.unknown(),
  itemResponses: z.array(zItemResponseDto).optional(),
});
export type SubmitAttemptDto = z.infer<typeof zSubmitAttemptDto>;

// ---- Self-study (Ser 1 "content library... self-study even when teacher --
// ---- not present", Phase 4) -----------------------------------------------

export const zCreateStudyModuleDto = z.object({
  title: z.string().min(1).max(200),
  exerciseIds: z.array(z.string().cuid2()).min(1),
});
export type CreateStudyModuleDto = z.infer<typeof zCreateStudyModuleDto>;

export const zUpdateStudyModuleDto = z.object({
  title: z.string().min(1).max(200).optional(),
  exerciseIds: z.array(z.string().cuid2()).min(1).optional(),
});
export type UpdateStudyModuleDto = z.infer<typeof zUpdateStudyModuleDto>;

// ---- LMS administration: batches, rosters, staff accounts ---------------------

/** Admin-typed display code, e.g. "ACTC-B01". Deliberately NOT `.cuid2()`
 * — that pattern is /^[0-9a-z]+$/, which rejects the uppercase letters
 * and hyphens a human-readable code is made of (Batch.id stays a real
 * cuid2 everywhere; `code` is a separate, human-facing column). Compared
 * case-insensitively (trim + uppercase) by BatchesService. */
export const zBatchCode = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits and . _ - only');

/** Admin-typed enrolment key, read out to the class. Compared
 * case-SENSITIVELY, unlike the code — an admin who types "Alpha-2026"
 * means exactly that. */
export const zBatchJoinKey = z.string().trim().min(6).max(64);

export const zCreateBatchDto = z.object({
  code: zBatchCode,
  name: z.string().trim().min(1).max(120),
  joinKey: zBatchJoinKey,
  joinOpen: z.boolean().optional(),
});
export type CreateBatchDto = z.infer<typeof zCreateBatchDto>;

export const zUpdateBatchDto = z
  .object({
    code: zBatchCode.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    joinKey: zBatchJoinKey.optional(),
    joinOpen: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });
export type UpdateBatchDto = z.infer<typeof zUpdateBatchDto>;

/** Student self-enrolment. Unlike zClaimStationDto (a station-side login
 * with the student's own credentials, from an unauthenticated seat), this
 * route requires a real STUDENT JWT from POST /auth/login — the key is a
 * second factor of "were you in the room", not a credential in its own
 * right (see BatchesService). */
export const zJoinBatchDto = z.object({
  code: zBatchCode,
  joinKey: zBatchJoinKey,
});
export type JoinBatchDto = z.infer<typeof zJoinBatchDto>;

export const zAssignBatchTeachersDto = z.object({
  teacherIds: z.array(z.string().cuid2()).min(1).max(50),
});
export type AssignBatchTeachersDto = z.infer<typeof zAssignBatchTeachersDto>;

export const zEnrollStudentsDto = z.object({
  studentIds: z.array(z.string().cuid2()).min(1).max(200),
});
export type EnrollStudentsDto = z.infer<typeof zEnrollStudentsDto>;

// ---- Staff/student account administration (admin-only user CRUD) --------------

export const zCreateUserDto = z.object({
  serviceNumber: z.string().trim().min(3).max(32),
  fullName: z.string().trim().min(1).max(120),
  role: zUserRole,
  password: z.string().min(8).max(128),
  rank: z.string().trim().min(1).max(32).optional(),
});
export type CreateUserDto = z.infer<typeof zCreateUserDto>;

export const zUpdateUserDto = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    rank: z.string().trim().min(1).max(32).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });
export type UpdateUserDto = z.infer<typeof zUpdateUserDto>;

export const zResetPasswordDto = z.object({ password: z.string().min(8).max(128) });
export type ResetPasswordDto = z.infer<typeof zResetPasswordDto>;
