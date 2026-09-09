import { z } from 'zod';
import { ActivityType } from '../types/enums.js';
import { registerActivity } from './registry.js';
import { zVocabularyTestConfig } from '../schemas/index.js';

/**
 * Concrete descriptors for every activity named in Annexure-I. Config
 * schemas here are the source of truth for what a teacher's authoring UI
 * produces and what DesiredStationState.activity.config must satisfy.
 *
 * Scoring/response depth matches the phase each activity lands in (see
 * build plan Phase 2-3) — Phase-2 activities have full response schemas
 * now; Phase-3 assessment activities' response schemas will be extended
 * when the gradebook module is built, without breaking this registry.
 */

// ---- Ser 2: Model Imitation -----------------------------------------------------

const zModelImitationConfig = z.object({
  masterTrackAssetId: z.string().cuid2(),
  /** Pre-authored pause points in the master track, in ms from start. */
  pausePoints: z.array(z.number().int().nonnegative()).default([]),
  allowManualPause: z.boolean().default(true),
});
const zModelImitationResponse = z.object({
  studentTrackAssetId: z.string().cuid2(),
  /** { masterOffsetMs, wallClockMs } pairs logged on every pause/resume. */
  pauseLog: z.array(z.object({ masterOffsetMs: z.number(), wallClockMs: z.number() })),
});
registerActivity({
  id: ActivityType.MODEL_IMITATION,
  label: 'Model Imitation',
  configSchema: zModelImitationConfig,
  responseSchema: zModelImitationResponse,
  playerComponent: 'ModelImitationPlayer',
  authoringComponent: 'ModelImitationAuthoring',
  realtimeRequirements: { mediaRoom: 'group', needsRecording: true, needsChairman: false },
});

// ---- Ser 3: Round Table Discussion ------------------------------------------------

const zRoundTableConfig = z.object({
  topic: z.string().min(1),
  /** Manual or automatic chairman assignment per Annexure-I Ser 3. */
  chairmanAssignment: z.enum(['manual', 'automatic']).default('manual'),
  micRequestQueueEnabled: z.boolean().default(true),
});
const zRoundTableResponse = z.object({
  recordingAssetId: z.string().cuid2().optional(),
  speakingTurns: z.array(z.object({ studentId: z.string().cuid2(), startMs: z.number(), endMs: z.number() })),
});
registerActivity({
  id: ActivityType.ROUND_TABLE,
  label: 'Round Table Discussion',
  configSchema: zRoundTableConfig,
  responseSchema: zRoundTableResponse,
  playerComponent: 'RoundTablePlayer',
  authoringComponent: 'RoundTableAuthoring',
  realtimeRequirements: { mediaRoom: 'group', needsRecording: true, needsChairman: true },
});

// ---- Ser 4: Content Exercise (HTML, grade/level-wise) -----------------------------

const zContentExerciseConfig = z.object({
  contentPackageId: z.string().cuid2(),
  gradeLevel: z.string().min(1),
});
const zContentExerciseResponse = z.object({
  score: z.number().min(0).max(100),
  itemResults: z.array(z.object({ itemId: z.string(), correct: z.boolean() })),
});
registerActivity({
  id: ActivityType.CONTENT_EXERCISE,
  label: 'Content Exercise',
  configSchema: zContentExerciseConfig,
  responseSchema: zContentExerciseResponse,
  playerComponent: 'ContentExercisePlayer',
  authoringComponent: 'ContentExerciseAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
});

// ---- Ser 5: Vocabulary Test (word-list import, large test bank) ------------------

const zVocabularyTestResponse = z.object({
  answers: z.array(z.object({ itemIndex: z.number().int(), givenAnswer: z.string(), correct: z.boolean().nullable() })),
  score: z.number().min(0).max(100).nullable(),
});
registerActivity({
  id: ActivityType.VOCABULARY_TEST,
  label: 'Vocabulary Test',
  configSchema: zVocabularyTestConfig,
  responseSchema: zVocabularyTestResponse,
  playerComponent: 'VocabularyTestPlayer',
  authoringComponent: 'VocabularyTestAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
});

// ---- Ser 6: Telephone Activity ----------------------------------------------------

const zTelephoneConfig = z.object({
  scenario: z.string().min(1).optional(),
  maxDurationSec: z.number().int().positive().default(600),
});
const zTelephoneResponse = z.object({
  recordingAssetId: z.string().cuid2().optional(),
  durationSec: z.number().nonnegative(),
});
registerActivity({
  id: ActivityType.TELEPHONE,
  label: 'Telephone Activity',
  configSchema: zTelephoneConfig,
  responseSchema: zTelephoneResponse,
  playerComponent: 'TelephonePlayer',
  authoringComponent: 'TelephoneAuthoring',
  realtimeRequirements: { mediaRoom: 'telephone', needsRecording: true, needsChairman: false },
});

// ---- Ser 7: Pronunciation Activity (any text -> pronunciation exercise) ----------

const zPronunciationConfig = z.object({
  sourceText: z.string().min(1),
  /** Populated by the offline eSpeak-NG/Piper pipeline (design doc "Offline speech pipeline"). */
  ipaAssetId: z.string().cuid2().optional(),
  modelAudioAssetId: z.string().cuid2().optional(),
  voice: z.enum(['en_US', 'en_GB']).default('en_GB'),
});
const zPronunciationResponse = z.object({
  studentAudioAssetId: z.string().cuid2(),
  selfAssessedScore: z.number().min(0).max(5).optional(),
  teacherAssessedScore: z.number().min(0).max(5).optional(),
});
registerActivity({
  id: ActivityType.PRONUNCIATION,
  label: 'Pronunciation Activity',
  configSchema: zPronunciationConfig,
  responseSchema: zPronunciationResponse,
  playerComponent: 'PronunciationPlayer',
  authoringComponent: 'PronunciationAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: true, needsChairman: false },
});

// ---- Ser 8: Conference Interpreting -----------------------------------------------

const zConferenceInterpretingConfig = z.object({
  topic: z.string().min(1),
  languages: z.array(z.string().min(2).max(8)).min(1),
  // Phase 5 finding: this was keyed by `studentId` since Phase 0, but a
  // session is authored against *stations* (a seat), not students — a
  // student isn't necessarily claimed onto any station yet at authoring
  // time (StationsService.claim happens at runtime, independent of
  // session composition), exactly like every other role assignment in
  // this system (SessionMember.role, ROUND_TABLE's chairmanStationId).
  // Renamed to stationId so authoring/session-state/the player all agree
  // on one identity space — the same class of bug the chairmanStationId
  // fix (Phase 2) already caught once.
  roles: z.array(
    z.object({
      stationId: z.string().cuid2(),
      role: z.enum(['INTERPRETER', 'DELEGATE', 'OBSERVER']),
      lang: z.string().min(2).max(8).optional(),
    }),
  ),
});
const zConferenceInterpretingResponse = z.object({
  interpretationRecordingAssetId: z.string().cuid2().optional(),
});
registerActivity({
  id: ActivityType.CONFERENCE_INTERPRETING,
  label: 'Conference Interpreting',
  configSchema: zConferenceInterpretingConfig,
  responseSchema: zConferenceInterpretingResponse,
  playerComponent: 'ConferenceInterpretingPlayer',
  authoringComponent: 'ConferenceInterpretingAuthoring',
  realtimeRequirements: { mediaRoom: 'interpreting', needsRecording: true, needsChairman: false },
});

// ---- Ser 9: Presentation Recording ------------------------------------------------

const zPresentationConfig = z.object({
  title: z.string().min(1),
  maxDurationSec: z.number().int().positive().default(900),
});
const zPresentationResponse = z.object({
  recordingAssetId: z.string().cuid2(),
  durationSec: z.number().nonnegative(),
});
registerActivity({
  id: ActivityType.PRESENTATION_RECORDING,
  label: 'Presentation Recording',
  configSchema: zPresentationConfig,
  responseSchema: zPresentationResponse,
  playerComponent: 'PresentationRecordingPlayer',
  authoringComponent: 'PresentationRecordingAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: true, needsChairman: false },
});

// ---- Self-Study (Ser 1: "content management library... even when teacher not present") --

const zSelfStudyConfig = z.object({
  studyModuleId: z.string().cuid2(),
});
const zSelfStudyResponse = z.object({
  completedExerciseIds: z.array(z.string().cuid2()),
  minutesSpent: z.number().nonnegative(),
});
registerActivity({
  id: ActivityType.SELF_STUDY,
  label: 'Self-Study Module',
  configSchema: zSelfStudyConfig,
  responseSchema: zSelfStudyResponse,
  playerComponent: 'SelfStudyPlayer',
  authoringComponent: 'SelfStudyAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
});
