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
  ActivityType.PRONUNCIATION_TEST,
  ActivityType.WRITING_TEST,
  ActivityType.LISTENING_TEST,
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
// passwordless roster pick), PLUS systemNumber — the number written on the
// PC's own screen, which becomes that station's seat number with no admin
// step (StationsService.claim resolves it via seatNoFromSystemNumber).
//
// classCode is OPTIONAL: signing in never needs a class. A student who
// signs in without one lands on their home screen (assignments, self-study,
// My classes) and can attach the seat to a teacher's live class afterwards
// via zJoinLiveClassDto. The field is kept, rather than deleted, so an
// older packaged desktop build that still sends it keeps working.
export const zClaimStationDto = z.object({
  serviceNumber: z.string().min(3).max(32),
  password: z.string().min(1),
  systemNumber: z.number().int().min(1).max(40),
  classCode: z.string().trim().min(1).max(12).optional(),
});
export type ClaimStationDto = z.infer<typeof zClaimStationDto>;

/** POST /classroom/join — attaches an already-signed-in seat to the live
 * class (ClassroomService.start) that owns `classCode`. Station-authenticated
 * like sign-in: which student is seated comes from Station.currentUserId. */
export const zJoinLiveClassDto = z.object({
  classCode: z.string().trim().min(1).max(12),
});
export type JoinLiveClassDto = z.infer<typeof zJoinLiveClassDto>;

/** POST /classroom/start — title is optional and defaults to "<teacher>'s
 * class" (ClassroomService.start); the code itself is server-generated,
 * never chosen by the teacher. `batchId` scopes the live class to one of
 * the teacher's My Classes rosters ("Start Live Class" on ClassDetailPage):
 * the default title becomes the class's name, every enrolled student
 * already signed in is attached immediately, and any enrolled student who
 * signs in later (while it stays ACTIVE) auto-joins too — no code needed
 * for that roster at all. Omitted, it is the existing ad-hoc Lab Control
 * flow, unchanged. */
export const zStartClassDto = z.object({
  title: z.string().trim().max(80).optional(),
  batchId: z.string().cuid2().optional(),
});
export type StartClassDto = z.infer<typeof zStartClassDto>;

// ---- Sessions / groups (design doc §4.5) ---------------------------------------

export const zCreateGroupDto = z.object({
  index: z.number().int().min(1).max(6),
  activityType: zActivityType,
  activityConfig: z.unknown(),
  memberStationIds: z.array(z.string().cuid2()).min(1).max(40),
  chairmanStationId: z.string().cuid2().optional(),
  // Offline dictionary (SPEC-offline-dictionary.md §7) — omitted means
  // "use the activity type's own default" (see resolveDictionaryEnabled).
  dictionaryEnabled: z.boolean().optional(),
});
export type CreateGroupDto = z.infer<typeof zCreateGroupDto>;

export const zCreateSessionDto = z.object({
  title: z.string().min(1).max(120),
  batchId: z.string().cuid2(),
  groups: z.array(zCreateGroupDto).min(1).max(6),
  /** stationId -> studentId, sent when the teacher picked STUDENTS (a
   * class's own activity screen) rather than seats. The server rejects the
   * session if any of those seats now has someone else signed in, or the
   * student is not in the class — the seat engine delivers to whoever is
   * sitting there, so a stale pick must never reach the wrong student. */
  expectedStudents: z.record(z.string().cuid2(), z.string().cuid2()).optional(),
});
export type CreateSessionDto = z.infer<typeof zCreateSessionDto>;

// ---- Round Table (Ser 3) -------------------------------------------------------

/** Station socket payload naming the group an rt:* event is about. The
 * caller's identity is NEVER read from here — it comes from the socket. */
export const zRtGroupRef = z.object({
  sessionId: z.string().min(1),
  groupId: z.string().min(1),
});
export type RtGroupRefDto = z.infer<typeof zRtGroupRef>;

export const zRtGrantPayload = zRtGroupRef.extend({ stationId: z.string().min(1) });
export type RtGrantPayload = z.infer<typeof zRtGrantPayload>;

export const zRtChairSpeaking = zRtGroupRef.extend({ speaking: z.boolean() });
export type RtChairSpeakingPayload = z.infer<typeof zRtChairSpeaking>;

export const zRtWatchPayload = z.object({ sessionId: z.string().min(1) });

/** Teacher REST body for grant / chairman: the target seat. */
export const zRoundTableStationDto = z.object({ stationId: z.string().min(1) });
export type RoundTableStationDto = z.infer<typeof zRoundTableStationDto>;

// ---- Vocabulary test / item bank (Ser 5, Ser 10) --------------------------------

export const zVocabularyItem = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  choices: z.array(z.string()).min(2).max(6).optional(),
  /** SPEC-mcq-test-timed-reveal.md §5.2 — shown on the results screen
   * after reveal. Never sent to a station before then. An empty string or
   * null (Prisma's shape for an unset nullable column — see zItemDto's own
   * comment on this) collapses to undefined, same convention as cefrTag. */
  explanation: z.preprocess((v) => (v ? v : undefined), z.string().trim().max(500).optional()),
});

/** GF-4: when correct answers become visible to the student. */
export const zTestRevealMode = z.enum(['ON_TIME_EXPIRY', 'ON_SUBMIT', 'ON_TEACHER_RELEASE']);
export type TestRevealMode = z.infer<typeof zTestRevealMode>;

/** What the student sees once revealed. */
export const zTestRevealDetail = z.enum(['SCORE_ONLY', 'SCORE_AND_FLAGS', 'FULL_ANSWERS']);
export type TestRevealDetail = z.infer<typeof zTestRevealDetail>;

// Two modes: authored inline (simple, self-contained in the config the
// student's client already holds) or sampled from an ItemBank (Ser 10
// "large test bank... different set of questions each attempt" — grading
// for this path is necessarily server-side, since the config a student
// receives must never carry the answer key for un-served items).
//
// revealMode/revealDetail/allowReview are deliberately left OPTIONAL here,
// unlike the spec's own `.default(...)` — a `.default()` plus the
// ON_TIME_EXPIRY-needs-a-time-limit refine below would reject every
// pre-existing config that has neither field, breaking "existing configs
// still parse" (see the parent spec's Phase 2 exit criterion). Callers
// read the *effective* policy through resolveTestPolicy() in
// ../types/timed-test.js, which supplies the same defaults only when the
// field is actually absent. The authoring UI always writes explicit values.
export const zVocabularyTestConfig = z
  .object({
    itemBankId: z.string().cuid2().optional(),
    sampleSize: z.number().int().positive().optional(),
    items: z.array(zVocabularyItem).optional(),
    shuffleItems: z.boolean().default(true),
    timeLimitSec: z.number().int().min(30).max(10_800).optional(),
    revealMode: zTestRevealMode.optional(),
    revealDetail: zTestRevealDetail.optional(),
    /** Allow changing an answer before submitting. */
    allowReview: z.boolean().optional(),
  })
  .refine((cfg) => Boolean(cfg.itemBankId) || (cfg.items?.length ?? 0) > 0, {
    message: 'Either itemBankId (with sampleSize) or a non-empty items[] is required',
    path: ['items'],
  })
  .refine((cfg) => cfg.revealMode !== 'ON_TIME_EXPIRY' || Boolean(cfg.timeLimitSec), {
    message: 'A time limit is required when answers are revealed on time expiry',
    path: ['timeLimitSec'],
  });
export type VocabularyTestConfig = z.infer<typeof zVocabularyTestConfig>;

/** One question in the Google-Forms-style builder (SPEC-mcq-test-timed-reveal.md
 * §7.1) — structurally enforces "exactly one correct answer" (correctIndex is a
 * single number, not a per-option boolean a teacher could tick twice or never). */
export const zVocabQuestionInput = z
  .object({
    prompt: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.preprocess((v) => (v ? v : undefined), z.string().trim().max(500).optional()),
    mediaAssetId: z.string().cuid2().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.correctIndex >= q.options.length) {
      ctx.addIssue({ code: 'custom', message: 'correctIndex is out of range', path: ['correctIndex'] });
    }
    const seen = new Set<string>();
    q.options.forEach((opt, i) => {
      const key = opt.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: `Option ${i + 1} duplicates an earlier option`, path: ['options', i] });
      }
      seen.add(key);
    });
  });
export type VocabQuestionInput = z.infer<typeof zVocabQuestionInput>;

export const zVocabTestSettings = z.object({
  timeLimitSec: z.number().int().min(30).max(10_800).optional(),
  revealMode: zTestRevealMode.default('ON_TIME_EXPIRY'),
  revealDetail: zTestRevealDetail.default('FULL_ANSWERS'),
  allowReview: z.boolean().default(true),
  /** Give each student a random subset of this many questions. */
  sampleSize: z.number().int().positive().max(500).optional(),
});
export type VocabTestSettings = z.infer<typeof zVocabTestSettings>;

// ---- Writing test / listening test (teacher-created assignments) -----------------
// Both keep their questions in the exercise's ItemBank rather than in this
// config — the same "config never carries what a student shouldn't hold in
// bulk" split VOCABULARY_TEST's bank mode and PRONUNCIATION_TEST use. A
// writing test's ItemBank holds the prompt (the student's essay comes back
// as ItemResponse.given); a listening test's holds the questions and their
// answer key. The config carries only what the student is meant to see.

export const zWritingTestConfig = z
  .object({
    instructions: z.string().trim().max(1000).optional(),
    minWords: z.number().int().positive().max(5000).optional(),
    maxWords: z.number().int().positive().max(5000).optional(),
  })
  .refine((cfg) => cfg.minWords === undefined || cfg.maxWords === undefined || cfg.minWords <= cfg.maxWords, {
    message: 'The minimum word count cannot be higher than the maximum',
    path: ['minWords'],
  });
export type WritingTestConfig = z.infer<typeof zWritingTestConfig>;

export const zListeningTestConfig = z.object({
  /** A MediaAsset of kind AUDIO that students can read (not PRIVATE). */
  audioAssetId: z.string().cuid2(),
  instructions: z.string().trim().max(1000).optional(),
});
export type ListeningTestConfig = z.infer<typeof zListeningTestConfig>;

// ---- Assignment (Ser 10 "tailored courses") -------------------------------------

export const zAssignmentDto = z.object({
  studentIds: z.array(z.string().cuid2()).min(1),
  exerciseIds: z.array(z.string().cuid2()).min(1),
  targetScore: z.number().min(0).max(100).optional(),
  allocatedHours: z.number().positive().optional(),
  dueAt: z.coerce.date().optional(),
  // The class this assignment was made from, if any — labels the
  // student's assignment/class history (see Assignment.batchId's own
  // comment). Never authorises; the roster check happens server-side.
  batchId: z.string().cuid2().optional(),
});
export type AssignmentDto = z.infer<typeof zAssignmentDto>;

// ---- Score override (Ser 4 — teachers must be able to edit scores) -------------

export const zScoreOverrideDto = z.object({
  attemptId: z.string().cuid2(),
  newScore: z.number().min(0).max(100),
  reason: z.string().min(1).max(500),
});
export type ScoreOverrideDto = z.infer<typeof zScoreOverrideDto>;

// ---- Pronunciation practice + teacher-run pronunciation test (Ser 7) ------------

export const zPronunciationVoice = z.enum(['en_US', 'en_GB']);

/** Shared ceiling for any pronunciation sourceText/speak text — zSpeakDto,
 * zGenerateDto (pronunciation.controller.ts) and
 * zCreatePronunciationExerciseDto all enforce the same number, since they
 * all ultimately feed the same eSpeak-NG/Piper pipeline (PronunciationService).
 * ~10,000 words at ~6 characters/word (average English word length plus a
 * space) — a full passage, not just a sentence. Long passages still cost
 * real synthesis time (see PIPER_TIMEOUT_MS in pronunciation.service.ts),
 * they just aren't rejected outright. */
export const PRONUNCIATION_TEXT_MAX_LENGTH = 60_000;

/** On-demand model voice + IPA — student word practice, a test's "hear the
 * word" button, teacher playback while grading, and a PRONUNCIATION
 * exercise's "Listen to pronunciation" button when the teacher didn't (or
 * couldn't) pre-generate model audio at authoring time. */
export const zSpeakDto = z.object({
  text: z.string().trim().min(1).max(PRONUNCIATION_TEXT_MAX_LENGTH),
  voice: zPronunciationVoice.default('en_GB'),
});
export type SpeakDto = z.infer<typeof zSpeakDto>;

/** One call authors the whole test: the words become ItemBank items and
 * every named student gets an Assignment (see PronunciationTestsService). */
export const zCreatePronunciationTestDto = z.object({
  title: z.string().trim().min(1).max(200),
  words: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    // Case-insensitive dedupe, first spelling wins — a repeated word would
    // just make the student record the same thing twice.
    .transform((words) => {
      const seen = new Set<string>();
      return words.filter((w) => {
        const key = w.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
  instructions: z.string().trim().max(500).optional(),
  /** Whether the student may hear the model voice before recording each word. */
  playModelAudio: z.boolean().default(false),
  voice: zPronunciationVoice.default('en_GB'),
  studentIds: z.array(z.string().cuid2()).min(1),
  dueAt: z.coerce.date().optional(),
});
export type CreatePronunciationTestDto = z.infer<typeof zCreatePronunciationTestDto>;

/** One call authors AND sends a PRONUNCIATION exercise (single text, single
 * recording, teacher-scored) — the simple one-step counterpart to
 * zCreatePronunciationTestDto's word list. sourceText is any sentence,
 * paragraph, or single word; IPA and model audio are deliberately not
 * generated here — they're synthesized on demand instead, both for the
 * student's "Listen to pronunciation" button and the teacher's review
 * preview (see PronunciationService.speak / zSpeakDto), so creating an
 * exercise never blocks on the offline speech pipeline. */
export const zCreatePronunciationExerciseDto = z.object({
  title: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().min(1).max(PRONUNCIATION_TEXT_MAX_LENGTH),
  voice: zPronunciationVoice.default('en_GB'),
  studentIds: z.array(z.string().cuid2()).min(1),
  dueAt: z.coerce.date().optional(),
  /** The class this was sent from, if any — see Assignment.batchId's own comment. */
  batchId: z.string().cuid2().optional(),
});
export type CreatePronunciationExerciseDto = z.infer<typeof zCreatePronunciationExerciseDto>;

/** Teacher's per-word 1-5 ratings for one submitted attempt. */
export const zGradePronunciationTestDto = z.object({
  ratings: z.array(z.object({ itemId: z.string().min(1), score: z.number().int().min(1).max(5) })).min(1),
  feedback: z.string().trim().max(500).optional(),
});
export type GradePronunciationTestDto = z.infer<typeof zGradePronunciationTestDto>;

// ---- Reading test (teacher gives a passage, student reads it aloud) -------------
// The passage lives in the exercise's ItemBank (prompt = the passage), not
// here — same split WRITING_TEST uses, so the student's recording can come
// back as that item's ItemResponse.given. The config carries only what the
// student's console needs: the instructions and which model voice the
// "Listen to pronunciation" button should ask for.
export const zReadingTestConfig = z.object({
  instructions: z.string().trim().max(1000).optional(),
  voice: zPronunciationVoice.default('en_GB'),
});
export type ReadingTestConfig = z.infer<typeof zReadingTestConfig>;

// ---- Create-assignment: vocabulary / writing / listening / reading tests ----------

const zAssessmentCommon = z.object({
  title: z.string().trim().min(1).max(200),
  studentIds: z.array(z.string().cuid2()).min(1),
  dueAt: z.coerce.date().optional(),
  /** The class it is created from (My Classes -> Create Assignment). Every
   * student must be enrolled in it; stored on each Assignment so the
   * student sees it in that class's history. */
  batchId: z.string().cuid2().optional(),
  // Offline dictionary (SPEC-offline-dictionary.md §7) — omitted means "use
  // the activity type's own default" (VOCABULARY_TEST off, everything
  // else on). Looking up the answer during a vocabulary test defeats the
  // test; a teacher can override it per test either way.
  dictionaryEnabled: z.boolean().optional(),
});

/** One call authors a whole test and assigns it (see AssessmentsService).
 * The question lists use the word-list import syntax — one per line,
 * `prompt = answer` or `prompt = answer | wrong | wrong` for multiple
 * choice — parsed server-side so there is a single parser. */
export const zCreateAssessmentDto = z.discriminatedUnion('type', [
  zAssessmentCommon.extend({
    type: z.literal(ActivityType.VOCABULARY_TEST),
    // Assigning students is optional for a vocabulary test: "save without
    // assigning" (SPEC-mcq-test-timed-reveal.md — a test meant for
    // "Launch in lab" would otherwise have to be assigned to someone
    // first, letting them open it early from My Assignments).
    studentIds: z.array(z.string().cuid2()).max(500),
    // Exactly one of these is required — enforced in AssessmentsService.build(),
    // not here (a discriminated union branch can't carry a cross-field
    // .refine() — see the READING_TEST branch's own comment on this).
    wordListText: z.string().min(1).max(20_000).optional(),
    /** The form-style builder's own question shape (GF-1) — kept alongside
     * wordListText, not replacing it, so the fast word-list import still
     * works as a seed the teacher then edits in the builder. */
    questions: z.array(zVocabQuestionInput).min(1).max(500).optional(),
    /** Give each student a random subset of this many questions. */
    sampleSize: z.number().int().positive().max(500).optional(),
    timeLimitSec: z.number().int().min(30).max(10_800).optional(),
    revealMode: zTestRevealMode.default('ON_TIME_EXPIRY'),
    revealDetail: zTestRevealDetail.default('FULL_ANSWERS'),
    allowReview: z.boolean().default(true),
  }),
  zAssessmentCommon.extend({
    type: z.literal(ActivityType.WRITING_TEST),
    prompt: z.string().trim().min(1).max(2000),
    instructions: z.string().trim().max(1000).optional(),
    minWords: z.number().int().positive().max(5000).optional(),
    maxWords: z.number().int().positive().max(5000).optional(),
  }),
  zAssessmentCommon.extend({
    type: z.literal(ActivityType.LISTENING_TEST),
    audioAssetId: z.string().cuid2(),
    instructions: z.string().trim().max(1000).optional(),
    questionsText: z.string().min(1).max(20_000),
  }),
  zAssessmentCommon.extend({
    type: z.literal(ActivityType.READING_TEST),
    // A teacher gives students something to read either way: text typed
    // here (kept well under PRONUNCIATION_TEXT_MAX_LENGTH — a passage the
    // model voice can read back in a reasonable time), or a PDF uploaded to
    // the Media Library (documentAssetId). At least one is required — enforced in
    // AssessmentsService.build(), not here, since a discriminated union
    // branch can't carry a cross-field .refine().
    passage: z.string().trim().max(2000).optional(),
    documentAssetId: z.string().cuid2().optional(),
    instructions: z.string().trim().max(1000).optional(),
    voice: zPronunciationVoice.default('en_GB'),
  }),
]);
export type CreateAssessmentDto = z.infer<typeof zCreateAssessmentDto>;

/** A teacher's mark for one hand-marked submission — a writing test's essay
 * or a reading test's recording — 0-100 plus the feedback the student sees
 * next to it on their console. */
export const zGradeAssessmentDto = z.object({
  score: z.number().min(0).max(100),
  feedback: z.string().trim().max(500).optional(),
});
export type GradeAssessmentDto = z.infer<typeof zGradeAssessmentDto>;
/** @deprecated Use zGradeAssessmentDto — kept so existing imports keep compiling. */
export const zGradeWritingTestDto = zGradeAssessmentDto;
/** @deprecated Use GradeAssessmentDto — kept so existing imports keep compiling. */
export type GradeWritingTestDto = GradeAssessmentDto;

// ---- Timed MCQ vocabulary tests (SPEC-mcq-test-timed-reveal.md) ----------------

/** PUT /assessments/:id — re-edit a saved test's questions/settings. Refused
 * server-side once any attempt exists (see AssessmentsService.update's doc
 * comment) — the same edit-after-attempts hazard setItems/importItems have
 * always had for the item bank underneath (a stale itemOrder/ItemResponse FK). */
export const zUpdateVocabTestDto = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  wordListText: z.string().min(1).max(20_000).optional(),
  questions: z.array(zVocabQuestionInput).min(1).max(500).optional(),
  sampleSize: z.number().int().positive().max(500).optional(),
  timeLimitSec: z.number().int().min(30).max(10_800).optional(),
  revealMode: zTestRevealMode.optional(),
  revealDetail: zTestRevealDetail.optional(),
  allowReview: z.boolean().optional(),
  dictionaryEnabled: z.boolean().optional(),
});
export type UpdateVocabTestDto = z.infer<typeof zUpdateVocabTestDto>;

/** PUT /attempts/:id/answers — buffers answers before submit, so a
 * disconnect never loses what the student has picked so far (§8.1). */
export const zSaveDraftAnswersDto = z.object({
  answers: z.array(z.object({ itemId: z.string().min(1), given: z.string().max(500) })).max(200),
});
export type SaveDraftAnswersDto = z.infer<typeof zSaveDraftAnswersDto>;

/** POST /activity-instances/launch — "Launch in lab" (§6.1): one call turns
 * a saved test into a live, one-group ClassSession over the class's
 * currently signed-in seats, already armed and started. `expectedStudents`
 * mirrors CreateSessionDto's own guard against a stale seat pick (see
 * SessionsService.assertExpectedStudents) — keyed by stationId. */
export const zLaunchTestDto = z.object({
  exerciseId: z.string().cuid2(),
  batchId: z.string().cuid2(),
  expectedStudents: z.record(z.string().cuid2(), z.string().cuid2()).refine((m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 40, {
    message: 'Pick between 1 and 40 students',
  }),
});
export type LaunchTestDto = z.infer<typeof zLaunchTestDto>;

/** POST /activity-instances/:id/extend */
export const zExtendTestDto = z.object({
  seconds: z.number().int().min(30).max(3600),
});
export type ExtendTestDto = z.infer<typeof zExtendTestDto>;

// ---- Media library (Ser 1 "media library... multi-teacher sharing") ------------

export const zMediaAssetScope = z.enum([MediaAssetScope.PRIVATE, MediaAssetScope.DEPARTMENT, MediaAssetScope.INSTITUTION]);

/** Metadata carried alongside the multipart upload (query/form fields —
 * the file itself isn't representable in zod, so this validates everything
 * except the binary). */
/** Classes (Batch ids) a study file is aimed at. Empty = every student. A
 * multipart form field arrives as one comma-separated string, so that is
 * accepted alongside a real array (a JSON body). */
const zSharedBatchIds = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(z.string().cuid2()).max(50),
  )
  .transform((ids) => [...new Set(ids)]);

export const zUploadMediaAssetDto = z.object({
  kind: z.enum([AssetKind.AUDIO, AssetKind.VIDEO, AssetKind.TEXT, AssetKind.IMAGE]),
  title: z.string().min(1).max(200).optional(),
  scope: zMediaAssetScope.default(MediaAssetScope.PRIVATE),
  /** Show the file in students' Study Material. Multipart form fields
   * arrive as strings, so 'true'/'false' is accepted too (z.coerce.boolean would
   * turn 'false' into true). Omitted = hidden. */
  studentVisible: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  /** Only students enrolled in one of these classes see it; omitted or empty = all students. */
  sharedBatchIds: zSharedBatchIds.optional(),
});
export type UploadMediaAssetDto = z.infer<typeof zUploadMediaAssetDto>;

export const zUpdateMediaAssetDto = z.object({
  title: z.string().min(1).max(200).optional(),
  scope: zMediaAssetScope.optional(),
  studentVisible: z.boolean().optional(),
  sharedBatchIds: zSharedBatchIds.optional(),
});
export type UpdateMediaAssetDto = z.infer<typeof zUpdateMediaAssetDto>;

/** POST /class-recordings — a teacher starting a recording of their own
 * class broadcast. See ClassRecordingsController. */
export const zStartClassRecordingDto = z.object({
  withAudio: z.boolean(),
});
export type StartClassRecordingDto = z.infer<typeof zStartClassRecordingDto>;

/** POST /class-recordings/:id/finish */
export const zFinishClassRecordingDto = z.object({
  durationMs: z.coerce.number().int().min(0),
});
export type FinishClassRecordingDto = z.infer<typeof zFinishClassRecordingDto>;

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
  // Offline dictionary (SPEC-offline-dictionary.md §7) — omitted/undefined
  // means "use the activity type's own default" (VOCABULARY_TEST off,
  // everything else on); an explicit true/false overrides it.
  dictionaryEnabled: z.boolean().optional(),
});
export type CreateExerciseDto = z.infer<typeof zCreateExerciseDto>;

export const zUpdateExerciseDto = z.object({
  title: z.string().min(1).max(200).optional(),
  config: z.unknown().optional(),
  dictionaryEnabled: z.boolean().optional(),
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
  // Same null/''-collapses-to-undefined convention as cefrTag above —
  // Prisma serialises Item.explanation as null when unset, not undefined.
  explanation: z.preprocess((v) => (v ? v : undefined), z.string().max(500).optional()),
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

// exerciseId is optional when activityInstanceId is given — a launched lab
// test derives its own exerciseId from ActivityInstance.exerciseId
// server-side (AttemptsService.start), rather than trusting a station to
// send the right one alongside it.
export const zStartAttemptDto = z
  .object({
    exerciseId: z.string().cuid2().optional(),
    assignmentId: z.string().cuid2().optional(),
    activityInstanceId: z.string().cuid2().optional(),
  })
  .refine((dto) => Boolean(dto.exerciseId) || Boolean(dto.activityInstanceId), {
    message: 'Either exerciseId or activityInstanceId is required',
    path: ['exerciseId'],
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

/** A module is a bundle of practice exercises and/or uploaded files (the
 * files are MediaAsset ids), so either list may be empty — but not both. */
export const zCreateStudyModuleDto = z
  .object({
    title: z.string().min(1).max(200),
    /** How the student should use this module to prepare — shown above its contents. */
    description: z.string().trim().max(2000).optional(),
    exerciseIds: z.array(z.string().cuid2()).default([]),
    materialAssetIds: z.array(z.string().cuid2()).default([]),
  })
  .refine((dto) => dto.exerciseIds.length + dto.materialAssetIds.length > 0, {
    message: 'Add at least one exercise or uploaded file',
  });
export type CreateStudyModuleDto = z.infer<typeof zCreateStudyModuleDto>;

export const zUpdateStudyModuleDto = z.object({
  title: z.string().min(1).max(200).optional(),
  /** An empty string clears the description. */
  description: z.string().trim().max(2000).optional(),
  exerciseIds: z.array(z.string().cuid2()).optional(),
  materialAssetIds: z.array(z.string().cuid2()).optional(),
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

/** A TEACHER creating their own classroom (POST /batches). A separate DTO
 * rather than a loosened zCreateBatchDto: the admin form keeps requiring
 * an explicit code and key, while a teacher may leave either blank and the
 * server generates it (BatchesService.createForTeacher). */
export const zCreateClassroomDto = z.object({
  name: z.string().trim().min(1).max(120),
  code: zBatchCode.optional(),
  joinKey: zBatchJoinKey.optional(),
  joinOpen: z.boolean().optional().default(true),
});
export type CreateClassroomDto = z.infer<typeof zCreateClassroomDto>;

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

// ---- Offline dictionary (SPEC-offline-dictionary.md §5) -----------------------

export const zDictionaryLookupQuery = z.object({ q: z.string().trim().min(1).max(64) });
export type DictionaryLookupQuery = z.infer<typeof zDictionaryLookupQuery>;

export const zDictionarySuggestQuery = z.object({
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().positive().max(8).default(8),
});
export type DictionarySuggestQuery = z.infer<typeof zDictionarySuggestQuery>;

export const zDictionarySearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().positive().max(20).default(20),
});
export type DictionarySearchQuery = z.infer<typeof zDictionarySearchQuery>;

export const zSetGroupDictionaryDto = z.object({ enabled: z.boolean() });
export type SetGroupDictionaryDto = z.infer<typeof zSetGroupDictionaryDto>;

// No batchId here on purpose — BatchAccessService's own doc comment
// documents that Gradebook/Reports-style aggregate queries (Attempt,
// Assignment; DictionaryLookup is the same shape) stay batch-unscoped,
// since a student can belong to more than one batch and scoping through
// Enrollment is ambiguous. This mirrors that precedent rather than
// inventing a new one.
//
// Always creates a NEW VOCABULARY_TEST exercise (bank mode, matching
// AssessmentsService.create's own item-bank wiring) rather than offering
// an "append to an existing exercise" option — an existing exercise may be
// in inline-config mode (Activity Type Registry's other VOCABULARY_TEST
// shape), and appending items to its ItemBank without also wiring
// config.itemBankId would silently do nothing at serve time. A "merge
// into an existing bank-mode test" option is a real follow-up, not
// implemented here.
export const zExportDictionaryWordsDto = z.object({
  title: z.string().trim().min(1).max(120),
  words: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});
export type ExportDictionaryWordsDto = z.infer<typeof zExportDictionaryWordsDto>;
