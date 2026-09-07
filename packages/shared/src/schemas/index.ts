import { z } from 'zod';
import { ActivityType, SessionRole, UserRole } from '../types/enums.js';

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
export const zVocabularyTestConfig = z.object({
  items: z.array(zVocabularyItem).min(1),
  shuffleItems: z.boolean().default(true),
  timeLimitSec: z.number().int().positive().optional(),
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
