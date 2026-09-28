import { z } from 'zod';
import { ActivityType } from '../types/enums.js';
import { registerActivity } from './registry.js';
import { zListeningTestConfig, zReadingTestConfig, zVocabularyTestConfig, zWritingTestConfig } from '../schemas/index.js';

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

/**
 * All fields added after the first version are optional or defaulted, so
 * exercises/sessions saved earlier still validate. `participantAssignment`
 * covers the "participants defined manually or with automatic options" half
 * of Ser 3 — the server splits the pool into groups at arm time (see
 * apps/server round-table-assignment.ts), so every client sees one result.
 */
export const zRoundTableConfig = z.object({
  topic: z.string().min(1),
  /** Manual or automatic chairman assignment per Annexure-I Ser 3. */
  chairmanAssignment: z.enum(['manual', 'automatic']).default('manual'),
  /** How participants are split into groups. */
  participantAssignment: z.enum(['manual', 'automatic']).default('manual'),
  /** Used when participantAssignment === 'automatic'. */
  targetGroupSize: z.number().int().min(2).max(10).optional(),
  /** Used when chairmanAssignment === 'automatic'. */
  chairmanStrategy: z.enum(['random', 'rotate']).default('random'),
  /** 'rotate' only: hand the chair to the next member every N seconds. */
  rotateEverySec: z.number().int().min(60).optional(),
  micRequestQueueEnabled: z.boolean().default(true),
  /** Optional cap per speaking turn; the chairman gets a warning, not a cutoff. */
  maxTurnSec: z.number().int().positive().optional(),
});
export type RoundTableConfig = z.infer<typeof zRoundTableConfig>;

/**
 * One stretch of speech. Keyed by `stationId` like every other Round Table
 * role assignment (chairmanStationId, SessionMember.role): a seat may be
 * unclaimed at runtime, so `studentId` is nullable and only attached when
 * a student had claimed the seat. The original shape keyed turns by
 * `studentId`, the same class of bug the Phase 2/5 notes below describe.
 * A TEACHER turn has no station, so `stationId` is null only for that role.
 * Times come from the server clock, relative to the activity start.
 */
export const zSpeakingTurn = z
  .object({
    stationId: z.string().cuid2().nullable(),
    studentId: z.string().cuid2().nullable(),
    teacherUserId: z.string().cuid2().nullable().default(null),
    role: z.enum(['CHAIRMAN', 'MEMBER', 'TEACHER']),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })
  .refine((t) => t.stationId !== null || t.role === 'TEACHER', {
    message: 'stationId may only be null for a TEACHER turn',
    path: ['stationId'],
  });
export type SpeakingTurn = z.infer<typeof zSpeakingTurn>;

const zRoundTableResponse = z.object({
  recordingAssetId: z.string().cuid2().optional(),
  speakingTurns: z.array(zSpeakingTurn),
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

// ---- Ser 7: Pronunciation Test (teacher gives words, student records each) --------
// The words themselves live in the exercise's ItemBank (prompt = the word),
// not in this config — the same "config never carries what the student
// shouldn't hold in bulk" split VOCABULARY_TEST's bank mode uses. Each
// recorded word travels in SubmitAttemptDto.itemResponses (given = the
// Recording id), so the response schema itself carries nothing.

const zPronunciationTestConfig = z.object({
  instructions: z.string().max(500).optional(),
  playModelAudio: z.boolean().default(false),
  voice: z.enum(['en_US', 'en_GB']).default('en_GB'),
});
registerActivity({
  id: ActivityType.PRONUNCIATION_TEST,
  label: 'Pronunciation Test',
  configSchema: zPronunciationTestConfig,
  responseSchema: z.object({}),
  playerComponent: 'PronunciationTestPlayer',
  authoringComponent: 'PronunciationTestAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: true, needsChairman: false },
});

// ---- Writing Test (teacher sets a prompt, student writes, teacher grades) ---------
// The prompt lives in the exercise's ItemBank; the essay travels in
// SubmitAttemptDto.itemResponses (given = the text), so the response
// schema itself carries nothing — same shape as PRONUNCIATION_TEST.

registerActivity({
  id: ActivityType.WRITING_TEST,
  label: 'Writing Test',
  configSchema: zWritingTestConfig,
  responseSchema: z.object({}),
  playerComponent: 'WritingTestPlayer',
  authoringComponent: 'WritingTestAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
});

// ---- Listening Test (one audio clip + auto-graded questions) ----------------------

registerActivity({
  id: ActivityType.LISTENING_TEST,
  label: 'Listening Test',
  configSchema: zListeningTestConfig,
  responseSchema: z.object({}),
  playerComponent: 'ListeningTestPlayer',
  authoringComponent: 'ListeningTestAuthoring',
  realtimeRequirements: { mediaRoom: 'none', needsRecording: false, needsChairman: false },
});

// ---- Reading Test (teacher gives a passage, student reads it aloud) --------------
// The passage lives in the exercise's ItemBank; the student's take travels
// in the response as a Recording id (the server re-checks it really
// uploaded — see AttemptsService.submitReadingTest) and is persisted as
// that item's ItemResponse.given so the teacher's results page finds it.
registerActivity({
  id: ActivityType.READING_TEST,
  label: 'Reading Test',
  configSchema: zReadingTestConfig,
  responseSchema: z.object({ studentAudioAssetId: z.string().cuid2() }),
  playerComponent: 'ReadingTestPlayer',
  authoringComponent: 'ReadingTestAuthoring',
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
