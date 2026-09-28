import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  resolveDictionaryEnabled,
  type ItemResponseDto,
  type StartAttemptDto,
  type SubmitAttemptDto,
  type VocabularyTestConfig,
  type WritingTestConfig,
  countWords,
} from '@lab/shared';
import { getActivity } from '@lab/shared/activities';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ServedItem {
  id: string; // real Item.id for bank mode, "inline:<index>" for inline mode
  prompt: string;
  choices: string[];
  // Phase 4 — Ser 10 "four key skills" needs a Listening item to actually
  // carry audio, not just text. Item.mediaAssetId already existed in the
  // schema since Phase 0 but nothing served or rendered it (bank-mode
  // only — zVocabularyItem, the inline shape, was never given a media
  // field, so an inline-authored item has nothing to forward here).
  mediaAssetId?: string;
}

// Types startable through this module — the assessment activities.
// Everything else (MODEL_IMITATION, ROUND_TABLE, ...) is Phase 2's live
// ActivityInstance flow, which doesn't create Exercise/Attempt rows.
const ATTEMPTABLE_TYPES: ActivityType[] = [
  ActivityType.CONTENT_EXERCISE,
  ActivityType.VOCABULARY_TEST,
  ActivityType.PRONUNCIATION,
  ActivityType.PRONUNCIATION_TEST,
  ActivityType.WRITING_TEST,
  ActivityType.LISTENING_TEST,
  ActivityType.READING_TEST,
];

// Teacher-controlled tests, as opposed to open practice: each can only be
// started through the student's own Assignment and, once submitted, is
// locked — a re-take needs the teacher to send it again. VOCABULARY_TEST is
// deliberately not here: it stays a retryable self-paced exercise. Nor is
// PRONUNCIATION — that stays retryable, self-rated practice; READING_TEST is
// its one-shot, teacher-marked counterpart (see submitReadingTest).
const ONE_SHOT_TYPES: ActivityType[] = [
  ActivityType.PRONUNCIATION_TEST,
  ActivityType.WRITING_TEST,
  ActivityType.LISTENING_TEST,
  ActivityType.READING_TEST,
];

// A writing test with no teacher-set maximum still gets a ceiling, so one
// submit can't carry an unbounded payload.
const DEFAULT_MAX_WORDS = 5000;

/**
 * Attempts + scoring (Ser 4, Ser 5, Ser 7, Ser 10). Grading authority
 * lives here, not in the Activity Type Registry's schemas: a randomized
 * test-bank attempt (Ser 10 "different set of questions each attempt")
 * can only be graded against the DB, since the student-facing config
 * must never carry the answer key for items it references — see
 * zVocabularyTestConfig's own comment on why inline vs. bank-sourced
 * items are two different trust boundaries.
 */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async start(studentId: string, dto: StartAttemptDto) {
    const exercise = await this.prisma.exercise.findUnique({ where: { id: dto.exerciseId } });
    if (!exercise) throw new NotFoundException('Exercise not found');
    if (!ATTEMPTABLE_TYPES.includes(exercise.type)) {
      throw new BadRequestException(`${exercise.type} attempts are not started through this endpoint — it is a live-session activity`);
    }

    if (ONE_SHOT_TYPES.includes(exercise.type)) {
      await this.assertTestStartable(studentId, exercise.id, dto.assignmentId);
    }

    const { maxScore, itemOrder, items } = await this.prepareServe(exercise.id, exercise.type, exercise.config);

    const attempt = await this.prisma.attempt.create({
      data: {
        exerciseId: exercise.id,
        studentId,
        assignmentId: dto.assignmentId,
        activityInstanceId: dto.activityInstanceId,
        maxScore,
        itemOrder,
        status: AttemptStatus.IN_PROGRESS,
      },
    });

    return {
      attemptId: attempt.id,
      exercise: {
        id: exercise.id,
        type: exercise.type,
        title: exercise.title,
        config: exercise.config,
        // Offline dictionary (SPEC-offline-dictionary.md §7) — the client
        // hides its dictionary panel while this is false (server-side
        // enforcement is DictionaryPolicyService, independent of this).
        dictionaryEnabled: resolveDictionaryEnabled(exercise.type, exercise.dictionaryEnabled),
      },
      items, // answer keys already stripped — see prepareServe
    };
  }

  async submit(attemptId: string, studentId: string, dto: SubmitAttemptDto) {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exercise: true } });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.studentId !== studentId) throw new ForbiddenException('This attempt belongs to a different student');
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException(`Attempt is already ${attempt.status.toLowerCase()}`);
    }

    const descriptor = getActivity(attempt.exercise.type);
    const responseResult = descriptor.responseSchema.safeParse(dto.response);
    if (!responseResult.success) {
      throw new BadRequestException({ message: 'Invalid response payload for this activity type', issues: responseResult.error.issues });
    }

    const { rawScore, status } = await this.score(attempt, attempt.exercise, responseResult.data, dto.itemResponses ?? []);

    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { rawScore, status, submittedAt: new Date() },
    });

    if (status === AttemptStatus.SCORED && rawScore !== null) {
      await this.recordSkillProgress(studentId, attempt.exercise.type, rawScore, attempt.maxScore ?? 100);
    }

    await this.audit.log({ actorId: studentId, action: 'attempt.submit', detail: { attemptId, rawScore, status } });
    return updated;
  }

  async get(id: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: { exercise: true, itemResponses: { include: { item: true } }, scoreOverride: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  async listForStudent(studentId: string) {
    return this.prisma.attempt.findMany({ where: { studentId }, include: { exercise: true }, orderBy: { startedAt: 'desc' } });
  }

  /** "My Assignments" — the standalone, self-paced launch point for
   * assessment activities (Ser 10 "teacher-tailored courses"). Each
   * assignment is joined with its most recent attempt (if any) so the
   * student console can show Start / Resume / Review correctly. */
  /**
   * A student can now be in several classes, so each row says where it came
   * from: `source.teacherName` always, and `source.className` when that
   * teacher teaches exactly ONE of the student's classes — unless the
   * assignment was created from a class (Assignment.batchId), which names it
   * directly. Either way it is a label only and never authorises anything; a
   * teacher who shares two classes with the student, or none any longer,
   * leaves className null and the UI falls back to the teacher.
   */
  async listAssignmentsForStudent(studentId: string) {
    const [assignments, enrollments] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { studentId },
        include: { exercise: true, teacher: { select: { fullName: true } }, batch: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.enrollment.findMany({
        where: { userId: studentId },
        select: { batch: { select: { name: true, teachers: { select: { teacherId: true } } } } },
      }),
    ]);
    const classNameFor = (teacherId: string): string | null => {
      const shared = enrollments.filter((e) => e.batch.teachers.some((t) => t.teacherId === teacherId));
      return shared.length === 1 ? (shared[0]?.batch.name ?? null) : null;
    };

    const results = await Promise.all(
      assignments.map(async ({ teacher, batch, ...a }) => {
        const latestAttempt = await this.prisma.attempt.findFirst({
          where: { studentId, exerciseId: a.exerciseId, assignmentId: a.id },
          orderBy: { startedAt: 'desc' },
          include: { scoreOverride: true },
        });
        return {
          assignment: a,
          exercise: a.exercise,
          latestAttempt,
          // An assignment created from a class knows it; older ones fall back to the guess.
          source: { teacherName: teacher.fullName, className: batch?.name ?? classNameFor(a.teacherId) },
        };
      }),
    );
    return results;
  }

  // ---- Serving (start) ----------------------------------------------------

  /** See ONE_SHOT_TYPES: started only through the student's own
   * Assignment, locked once submitted — a re-take needs the teacher to
   * send it again (a fresh Assignment). */
  private async assertTestStartable(studentId: string, exerciseId: string, assignmentId?: string): Promise<void> {
    if (!assignmentId) throw new BadRequestException('A test can only be started from your assignments');
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.studentId !== studentId || assignment.exerciseId !== exerciseId) {
      throw new ForbiddenException('This test is not assigned to you');
    }
    const submitted = await this.prisma.attempt.count({
      where: { assignmentId, status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.SCORED] } },
    });
    if (submitted > 0) throw new BadRequestException('You have already submitted this test');
  }

  private async prepareServe(
    exerciseId: string,
    type: ActivityType,
    config: unknown,
  ): Promise<{ maxScore: number; itemOrder: string[]; items?: ServedItem[] }> {
    if (type === ActivityType.PRONUNCIATION) return { maxScore: 5, itemOrder: [] };
    if (type === ActivityType.CONTENT_EXERCISE) return { maxScore: 100, itemOrder: [] };

    if (type === ActivityType.PRONUNCIATION_TEST || type === ActivityType.WRITING_TEST || type === ActivityType.READING_TEST) {
      // Words (or the writing prompt / reading passage) are served in the
      // teacher's authored order (no shuffling — the teacher reads them back
      // in that order when grading). Model audio is fetched on demand via
      // /pronunciation/speak, never carried as a mediaAssetId here — except
      // for a reading test, where mediaAssetId instead means the teacher's
      // uploaded PDF (there is no per-item audio for this type, so the
      // field can't be ambiguous between the two).
      const bank = await this.prisma.itemBank.findUnique({
        where: { exerciseId },
        include: { items: { orderBy: { order: 'asc' } } },
      });
      if (!bank || bank.items.length === 0) {
        throw new BadRequestException(
          type === ActivityType.WRITING_TEST ? 'This test has no prompt' : type === ActivityType.READING_TEST ? 'This test has no passage' : 'This test has no words',
        );
      }
      return {
        maxScore: 100,
        itemOrder: bank.items.map((i) => i.id),
        items: bank.items.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          choices: [],
          mediaAssetId: type === ActivityType.READING_TEST ? (i.mediaAssetId ?? undefined) : undefined,
        })),
      };
    }

    if (type === ActivityType.LISTENING_TEST) {
      // Questions follow the audio, so they keep the teacher's order; only
      // each question's choices are shuffled (see shuffleChoices). The clip
      // itself is in the exercise config, not per item.
      const bank = await this.prisma.itemBank.findUnique({
        where: { exerciseId },
        include: { items: { orderBy: { order: 'asc' } } },
      });
      if (!bank || bank.items.length === 0) throw new BadRequestException('This test has no questions');
      return {
        maxScore: 100,
        itemOrder: bank.items.map((i) => i.id),
        items: bank.items.map((i) => ({ id: i.id, prompt: i.prompt, choices: shuffleChoices(i.choices) })),
      };
    }

    // VOCABULARY_TEST
    const cfg = config as VocabularyTestConfig;
    if (cfg.itemBankId) {
      const bank = await this.prisma.itemBank.findUnique({ where: { id: cfg.itemBankId }, include: { items: true } });
      if (!bank || bank.exerciseId !== exerciseId) throw new BadRequestException('itemBankId does not belong to this exercise');
      const sampleSize = Math.min(cfg.sampleSize ?? bank.items.length, bank.items.length);
      const sampled = shuffle(bank.items).slice(0, sampleSize);
      return {
        maxScore: 100,
        itemOrder: sampled.map((i) => i.id),
        items: sampled.map((i) => ({ id: i.id, prompt: i.prompt, choices: shuffleChoices(i.choices), mediaAssetId: i.mediaAssetId ?? undefined })),
      };
    }

    const items = cfg.items ?? [];
    const order = cfg.shuffleItems ? shuffle(items.map((_, idx) => idx)) : items.map((_, idx) => idx);
    return {
      maxScore: 100,
      itemOrder: order.map((idx) => `inline:${idx}`),
      items: order.map((idx) => ({ id: `inline:${idx}`, prompt: items[idx]!.prompt, choices: items[idx]!.choices ?? [] })),
    };
  }

  // ---- Scoring (submit) ----------------------------------------------------

  private async score(
    attempt: { id: string; itemOrder: string[]; exerciseId: string },
    exercise: { type: ActivityType; config: unknown },
    response: unknown,
    itemResponses: ItemResponseDto[],
  ): Promise<{ rawScore: number | null; status: string }> {
    if (exercise.type === ActivityType.CONTENT_EXERCISE) {
      // SCORM/xAPI/HTML content self-reports via the client-side SCORM API
      // shim (see content/content-packages.service.ts's doc comment) — the
      // server trusts the package's own score the same way it trusts a
      // teacher's manual grading, because the alternative (a full SCORM
      // RTE re-deriving cmi.core.score.raw server-side) is out of scope.
      const r = response as { score: number };
      return { rawScore: r.score, status: AttemptStatus.SCORED };
    }

    if (exercise.type === ActivityType.PRONUNCIATION) {
      return this.submitPronunciation(attempt, response as { studentAudioAssetId: string; selfAssessedScore?: number });
    }

    if (exercise.type === ActivityType.PRONUNCIATION_TEST) {
      return this.submitPronunciationTest(attempt, itemResponses);
    }

    if (exercise.type === ActivityType.WRITING_TEST) {
      return this.submitWritingTest(attempt, exercise.config as WritingTestConfig, itemResponses);
    }

    if (exercise.type === ActivityType.READING_TEST) {
      return this.submitReadingTest(attempt, response as { studentAudioAssetId: string });
    }

    // A listening test is graded exactly like a bank-mode vocabulary test:
    // each question against its stored answer.
    if (exercise.type === ActivityType.LISTENING_TEST) {
      return this.scoreVocabularyTest(attempt, {}, itemResponses);
    }

    // VOCABULARY_TEST
    return this.scoreVocabularyTest(attempt, exercise.config as VocabularyTestConfig, itemResponses);
  }

  /** No score yet — a teacher marks the essay later
   * (AssessmentsService.grade). The server, not the client, is the
   * authority on the word limits: the student console's counter is only a
   * convenience. */
  private async submitWritingTest(
    attempt: { id: string; itemOrder: string[] },
    config: WritingTestConfig,
    itemResponses: ItemResponseDto[],
  ): Promise<{ rawScore: number | null; status: string }> {
    const givenByItemId = new Map(itemResponses.map((r) => [r.itemId, r.given]));
    const minWords = config.minWords ?? 1;
    const maxWords = config.maxWords ?? DEFAULT_MAX_WORDS;

    const rows = attempt.itemOrder.map((itemId, order) => ({
      attemptId: attempt.id,
      itemId,
      given: (givenByItemId.get(itemId) ?? '').trim(),
      order,
    }));
    for (const row of rows) {
      const words = countWords(row.given);
      if (words === 0) throw new BadRequestException('Write your answer before submitting');
      if (words < minWords) throw new BadRequestException(`Too short — write at least ${minWords} words (you have ${words})`);
      if (words > maxWords) throw new BadRequestException(`Too long — write at most ${maxWords} words (you have ${words})`);
    }

    await this.prisma.itemResponse.createMany({ data: rows });
    return { rawScore: null, status: AttemptStatus.SUBMITTED };
  }

  /** The student can re-record (Improvise) any number of times before
   * submitting, so this asserts the CLAIMED take is a finished recording of
   * THIS attempt — ActivityRecorder.stop() only logs a failed upload, so
   * without this a student could submit a take that never arrived. Shared
   * by submitPronunciation and submitReadingTest. */
  private async assertReadyTake(attemptId: string, recordingId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
      select: { attemptId: true, status: true },
    });
    if (!recording || recording.attemptId !== attemptId || recording.status !== 'ready') {
      throw new BadRequestException('Your recording did not finish uploading — record it again before submitting');
    }
  }

  /** Awaits a teacher's assessment (via the gradebook's ScoreOverride —
   * "oldScore: null" legitimately means "first score", not "editing a
   * machine score") rather than auto-scoring off a self-rating. */
  private async submitPronunciation(
    attempt: { id: string },
    response: { studentAudioAssetId: string },
  ): Promise<{ rawScore: number | null; status: string }> {
    await this.assertReadyTake(attempt.id, response.studentAudioAssetId);
    const r = response as { selfAssessedScore?: number };
    return { rawScore: r.selfAssessedScore ?? null, status: AttemptStatus.SUBMITTED };
  }

  /** No score yet — a teacher marks the recording later
   * (AssessmentsService.grade), same as a writing test's essay. The
   * passage is served as this attempt's one item (itemOrder[0]), so the
   * recording id is stored against that item's id — never trusting the
   * client to name it — and the teacher's results page finds it the same
   * way it finds a written essay. */
  private async submitReadingTest(
    attempt: { id: string; itemOrder: string[] },
    response: { studentAudioAssetId: string },
  ): Promise<{ rawScore: number | null; status: string }> {
    await this.assertReadyTake(attempt.id, response.studentAudioAssetId);
    const itemId = attempt.itemOrder[0];
    if (!itemId) throw new BadRequestException('This test has no passage');
    await this.prisma.itemResponse.createMany({
      data: [{ attemptId: attempt.id, itemId, given: response.studentAudioAssetId, order: 0 }],
    });
    return { rawScore: null, status: AttemptStatus.SUBMITTED };
  }

  /** No score yet — a teacher rates each word later (PronunciationTestsService.grade).
   * What the server can and must check here is that every word actually
   * has its own finished recording of THIS attempt: ActivityRecorder.stop()
   * only logs a failed upload, so without this a student could submit a
   * test whose audio never arrived. */
  private async submitPronunciationTest(
    attempt: { id: string; itemOrder: string[] },
    itemResponses: ItemResponseDto[],
  ): Promise<{ rawScore: number | null; status: string }> {
    const recordingByItemId = new Map(itemResponses.map((r) => [r.itemId, r.given]));
    const claimed = attempt.itemOrder.map((itemId) => recordingByItemId.get(itemId));

    const ready = await this.prisma.recording.findMany({
      where: { id: { in: claimed.filter((id): id is string => Boolean(id)) }, attemptId: attempt.id, status: 'ready' },
      select: { id: true },
    });
    const readyIds = new Set(ready.map((r) => r.id));
    const missingItemIds = attempt.itemOrder.filter((_, i) => !claimed[i] || !readyIds.has(claimed[i]!));
    if (missingItemIds.length > 0) {
      const words = await this.prisma.item.findMany({ where: { id: { in: missingItemIds } }, select: { id: true, prompt: true } });
      const promptById = new Map(words.map((w) => [w.id, w.prompt]));
      throw new BadRequestException(
        `Record every word before submitting — missing: ${missingItemIds.map((id) => promptById.get(id) ?? id).join(', ')}`,
      );
    }
    if (new Set(claimed).size !== claimed.length) {
      throw new BadRequestException('Each word needs its own recording');
    }

    await this.prisma.itemResponse.createMany({
      data: attempt.itemOrder.map((itemId, order) => ({ attemptId: attempt.id, itemId, given: recordingByItemId.get(itemId)!, order })),
    });
    return { rawScore: null, status: AttemptStatus.SUBMITTED };
  }

  private async scoreVocabularyTest(
    attempt: { id: string; itemOrder: string[] },
    config: Pick<VocabularyTestConfig, 'items'>,
    itemResponses: ItemResponseDto[],
  ): Promise<{ rawScore: number; status: string }> {
    if (attempt.itemOrder.length === 0) return { rawScore: 0, status: AttemptStatus.SCORED };

    const givenByItemId = new Map(itemResponses.map((r) => [r.itemId, r]));
    const isBankMode = !attempt.itemOrder[0]!.startsWith('inline:');

    let answerKey = new Map<string, string>();
    if (isBankMode) {
      const items = await this.prisma.item.findMany({ where: { id: { in: attempt.itemOrder } } });
      answerKey = new Map(items.map((i) => [i.id, i.answer]));
    } else {
      const inlineItems = config.items ?? [];
      answerKey = new Map(attempt.itemOrder.map((key) => [key, inlineItems[Number(key.split(':')[1])]?.answer ?? '']));
    }

    let correctCount = 0;
    const responseRows: Array<{ itemId: string; given: string; correct: boolean; order: number }> = [];
    attempt.itemOrder.forEach((itemId, order) => {
      const given = givenByItemId.get(itemId)?.given ?? '';
      const correctAnswer = answerKey.get(itemId) ?? '';
      const correct = normalize(given) === normalize(correctAnswer);
      if (correct) correctCount += 1;
      responseRows.push({ itemId, given, correct, order });
    });

    // ItemResponse.itemId has a real FK to Item — only persist rows for
    // bank-sourced items, which have one. Inline items were never given
    // an Item row (they live only in the exercise's config JSON), so
    // there is nothing valid to point the FK at; the score itself is
    // still computed and stored on Attempt either way.
    if (isBankMode) {
      await this.prisma.itemResponse.createMany({
        data: responseRows.map((r) => ({ attemptId: attempt.id, itemId: r.itemId, given: r.given, correct: r.correct, order: r.order })),
      });
    }

    const rawScore = Math.round((correctCount / attempt.itemOrder.length) * 100);
    return { rawScore, status: AttemptStatus.SCORED };
  }

  private async recordSkillProgress(studentId: string, type: ActivityType, rawScore: number, maxScore: number): Promise<void> {
    const skill =
      type === ActivityType.VOCABULARY_TEST
        ? 'vocabulary'
        : type === ActivityType.PRONUNCIATION
          ? 'pronunciation'
          : type === ActivityType.LISTENING_TEST
            ? 'listening'
            : 'reading';
    const percentage = maxScore > 0 ? (rawScore / maxScore) * 100 : 0;
    await this.prisma.skillProgress.create({ data: { studentId, skill, score: percentage } });
  }
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** MCQ choices are stored answer-first (see parseWordListText), so serving
 * them as stored would hand every student the correct answer in slot one.
 * Free-response items have no choices and pass through untouched. */
function shuffleChoices(choices: string[]): string[] {
  return choices.length > 1 ? shuffle(choices) : choices;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
