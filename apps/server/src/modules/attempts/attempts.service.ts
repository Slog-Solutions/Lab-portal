import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  SessionState,
  TEST_ERROR_CODES,
  resolveDictionaryEnabled,
  resolveTestPolicy,
  type AttemptResultView,
  type ItemResponseDto,
  type SaveDraftAnswersDto,
  type StartAttemptDto,
  type SubmitAttemptDto,
  type VocabularyTestConfig,
  type WritingTestConfig,
  countWords,
} from '@lab/shared';
import { getActivity } from '@lab/shared/activities';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { projectConfigForStation } from '../../common/served-config';

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
// ActivityInstance flow, which doesn't create Exercise/Attempt rows
// UNLESS it's a launched vocabulary test (see startLiveTest) — that one
// still goes through this module's Attempt/ItemResponse pipeline, the
// live ActivityInstance is just where the deadline/reveal state lives.
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
// deliberately not here even though a real timed/teacher-released one is
// ALSO one-shot now (see resolveTestPolicy) — that rule is per-config, not
// per-type, so it's enforced separately in startSelfPaced/startLiveTest.
// Nor is PRONUNCIATION — that stays retryable, self-rated practice;
// READING_TEST is its one-shot, teacher-marked counterpart (see submitReadingTest).
const ONE_SHOT_TYPES: ActivityType[] = [
  ActivityType.PRONUNCIATION_TEST,
  ActivityType.WRITING_TEST,
  ActivityType.LISTENING_TEST,
  ActivityType.READING_TEST,
];

// A writing test with no teacher-set maximum still gets a ceiling, so one
// submit can't carry an unbounded payload.
const DEFAULT_MAX_WORDS = 5000;

type VocabPolicy = ReturnType<typeof resolveTestPolicy>;

/**
 * Attempts + scoring (Ser 4, Ser 5, Ser 7, Ser 10). Grading authority
 * lives here, not in the Activity Type Registry's schemas: a randomized
 * test-bank attempt (Ser 10 "different set of questions each attempt")
 * can only be graded against the DB, since the student-facing config
 * must never carry the answer key for items it references — see
 * zVocabularyTestConfig's own comment on why inline vs. bank-sourced
 * items are two different trust boundaries.
 *
 * SPEC-mcq-test-timed-reveal.md adds a second trust boundary on top: a
 * VOCABULARY_TEST attempt's *correctness* must not be disclosed to the
 * student before its reveal moment (Attempt.revealAt). See
 * finalizeVocabAttempt and getResult. LISTENING_TEST is graded with the
 * same pure gradeVocab() logic (see scoreListeningTest) but is NOT routed
 * through the timed-reveal machinery — it predates this spec, has no
 * player built for a live/timed run, and keeps its original "reveal
 * immediately on submit" contract untouched.
 */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async start(studentId: string, stationId: string, dto: StartAttemptDto) {
    if (dto.activityInstanceId) {
      return this.startLiveTest(studentId, stationId, dto.activityInstanceId, dto.exerciseId);
    }
    return this.startSelfPaced(studentId, dto);
  }

  async submit(attemptId: string, studentId: string, dto: SubmitAttemptDto) {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exercise: true } });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.studentId !== studentId) throw new ForbiddenException('This attempt belongs to a different student');

    if (attempt.exercise.type === ActivityType.VOCABULARY_TEST) {
      return this.submitVocab(attempt, studentId, dto);
    }

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

  /** PUT /attempts/:id/answers — buffers answers before submit (§8.1). One
   * atomic conditional update: a save that lands after the close sequence
   * claimed this attempt (or after the student already submitted) fails
   * cleanly with a distinct code, never silently succeeding past the
   * deadline. */
  async saveDraft(attemptId: string, studentId: string, dto: SaveDraftAnswersDto): Promise<{ ok: true }> {
    const now = new Date();
    const current = await this.prisma.attempt.findUnique({ where: { id: attemptId }, select: { studentId: true, status: true, answers: true } });
    if (!current) throw new NotFoundException('Attempt not found');
    if (current.studentId !== studentId) throw new ForbiddenException('This attempt belongs to a different student');

    const merged: Record<string, string> = { ...((current.answers as Record<string, string> | null) ?? {}) };
    for (const a of dto.answers) merged[a.itemId] = a.given;

    const result = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS, OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
      data: { answers: merged as unknown as Prisma.InputJsonValue },
    });
    if (result.count === 0) {
      if (current.status !== AttemptStatus.IN_PROGRESS) {
        throw new BadRequestException({ message: 'This test has already been submitted', code: TEST_ERROR_CODES.ALREADY_SUBMITTED });
      }
      throw new BadRequestException({ message: 'This test is closed', code: TEST_ERROR_CODES.TEST_CLOSED });
    }
    return { ok: true };
  }

  /** Public entry point for TestCloseService's sweep (§6.2 close
   * scheduler) — auto-submits one attempt past its deadline, cohort or
   * individual, with `enforceDeadline: false` since the deadline is
   * exactly WHY this is being called. A no-op (returns false) if the
   * attempt already left IN_PROGRESS by the time this runs (the student's
   * own submit won the race — see finalizeVocabAttempt's own doc comment). */
  async autoSubmitExpired(attemptId: string): Promise<boolean> {
    const outcome = await this.finalizeVocabAttempt(attemptId, { enforceDeadline: false, now: new Date() });
    return outcome !== null;
  }

  /** GET /attempts/:id/result. `opts.staff` bypasses both ownership and
   * reveal (§6.4 "Teacher/admin → always full detail, regardless of
   * reveal state"); callers pass it only after their own role check. */
  async getResult(attemptId: string, studentId: string, opts?: { staff?: boolean }): Promise<AttemptResultView> {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exercise: true } });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!opts?.staff && attempt.studentId !== studentId) throw new ForbiddenException('This attempt belongs to a different student');
    if (attempt.exercise.type !== ActivityType.VOCABULARY_TEST) {
      throw new BadRequestException('Results for this activity type are shown in My Assignments, not through this endpoint');
    }

    // Lazy finalize: a station that was offline when the sweep ran still
    // gets a correct result the moment it asks (§4.6 "Offline").
    if (attempt.status === AttemptStatus.IN_PROGRESS && attempt.closesAt && attempt.closesAt.getTime() <= Date.now()) {
      const outcome = await this.finalizeVocabAttempt(attemptId, { enforceDeadline: false, now: new Date() });
      if (outcome) return this.getResult(attemptId, studentId, opts);
    }

    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      return { status: 'OPEN' };
    }

    const now = new Date();
    const revealed = Boolean(opts?.staff) || (attempt.revealAt !== null && attempt.revealAt <= now);
    const policy = resolveTestPolicy(attempt.exercise.config as VocabularyTestConfig);
    if (!revealed) {
      return {
        status: 'WAITING',
        awaiting: policy.revealMode === 'ON_TEACHER_RELEASE' ? 'TEACHER' : 'TIME',
        closesAt: attempt.closesAt ? attempt.closesAt.getTime() : null,
        serverNow: now.getTime(),
      };
    }

    const effectiveDetail = opts?.staff ? 'FULL_ANSWERS' : policy.revealDetail;
    const served = ((attempt.served as unknown as ServedItem[] | null) ?? []).reduce<Map<string, ServedItem>>((m, s) => m.set(s.id, s), new Map());
    const answers = (attempt.answers as Record<string, string> | null) ?? {};
    const key = await this.resolveAnswerKey(attempt.itemOrder, attempt.exercise.type, attempt.exercise.config);

    const items = attempt.itemOrder.map((itemId) => {
      const s = served.get(itemId);
      const k = key.get(itemId);
      const given = answers[itemId] ?? '';
      const base = { itemId, prompt: s?.prompt ?? '', choices: s?.choices ?? [], given };
      if (effectiveDetail === 'SCORE_ONLY') return base;
      const correct = normalize(given) === normalize(k?.answer ?? '');
      if (effectiveDetail === 'SCORE_AND_FLAGS') return { ...base, correct };
      return { ...base, correct, correctAnswer: k?.answer, explanation: k?.explanation };
    });

    return { status: 'RELEASED', rawScore: attempt.rawScore, maxScore: attempt.maxScore, revealDetail: effectiveDetail, items };
  }

  /** A student's own attempt history — never the exercise's raw config
   * (see the class doc comment's "must never carry the answer key"), and
   * a not-yet-revealed VOCABULARY_TEST row is masked the same way
   * listAssignmentsForStudent masks it. */
  async listForStudent(studentId: string, exerciseId?: string) {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId, ...(exerciseId ? { exerciseId } : {}) },
      include: { exercise: { select: { id: true, type: true, title: true } }, scoreOverride: true },
      orderBy: { startedAt: 'desc' },
    });
    return attempts.map((a) => this.maskAttemptRow(a));
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

    const now = new Date();
    const results = await Promise.all(
      assignments.map(async ({ teacher, batch, ...a }) => {
        const latestAttemptRaw = await this.prisma.attempt.findFirst({
          where: { studentId, exerciseId: a.exerciseId, assignmentId: a.id },
          orderBy: { startedAt: 'desc' },
          include: { scoreOverride: true },
        });
        const oneShot =
          ONE_SHOT_TYPES.includes(a.exercise.type) ||
          (a.exercise.type === ActivityType.VOCABULARY_TEST && resolveTestPolicy(a.exercise.config as VocabularyTestConfig).oneShot);
        const pending =
          a.exercise.type === ActivityType.VOCABULARY_TEST &&
          latestAttemptRaw?.status === AttemptStatus.SCORED &&
          (latestAttemptRaw.revealAt === null || latestAttemptRaw.revealAt > now);
        const latestAttempt = pending
          ? { ...latestAttemptRaw!, status: AttemptStatus.SUBMITTED, rawScore: null, maxScore: null, scoreOverride: null }
          : latestAttemptRaw;
        return {
          assignment: a,
          // Never the raw config here either — see the class doc comment.
          exercise: { id: a.exercise.id, type: a.exercise.type, title: a.exercise.title },
          latestAttempt,
          oneShot,
          resultsPending: Boolean(pending),
          // An assignment created from a class knows it; older ones fall back to the guess.
          source: { teacherName: teacher.fullName, className: batch?.name ?? classNameFor(a.teacherId) },
        };
      }),
    );
    return results;
  }

  // ---- Serving (start) ----------------------------------------------------

  /** "Launch in lab" mode — the seat's own membership in the launched
   * group IS the authorization (§6.1); there is no Assignment row. */
  private async startLiveTest(studentId: string, stationId: string, instanceId: string, exerciseIdHint?: string) {
    const instance = await this.prisma.activityInstance.findUnique({
      where: { id: instanceId },
      include: { group: { include: { session: true } } },
    });
    if (!instance || !instance.exerciseId) throw new NotFoundException('Test not found');
    if (exerciseIdHint && exerciseIdHint !== instance.exerciseId) {
      throw new BadRequestException('exerciseId does not match this test');
    }
    const sessionState = instance.group.session.state;
    if (sessionState === SessionState.DRAFT || sessionState === SessionState.ARMED) {
      throw new BadRequestException({ message: 'This test has not started yet', code: TEST_ERROR_CODES.TEST_NOT_STARTED });
    }

    const member = await this.prisma.sessionMember.findUnique({
      where: { groupId_stationId: { groupId: instance.groupId, stationId } },
    });
    if (!member) throw new ForbiddenException('This station is not part of this test');

    const exercise = await this.prisma.exercise.findUniqueOrThrow({ where: { id: instance.exerciseId } });

    const existing = await this.prisma.attempt.findFirst({
      where: { activityInstanceId: instance.id, studentId },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      if (existing.status === AttemptStatus.IN_PROGRESS) return this.resumeAttemptResponse(existing, exercise);
      throw new BadRequestException({
        message: 'You have already submitted this test',
        code: TEST_ERROR_CODES.ALREADY_SUBMITTED,
        attemptId: existing.id,
      });
    }

    // Read right here, right before creating (same convention
    // session-state.service.ts documents on its own late-read) — shrinks
    // the window against a close claimed in between, though a request
    // that still slips through creates an attempt that the very next 5s
    // sweep picks up (closesAt already passed) and scores from whatever
    // was answered — never an early reveal, at worst a fairness edge case.
    const fresh = await this.prisma.activityInstance.findUniqueOrThrow({ where: { id: instance.id }, select: { closedAt: true, closesAt: true } });
    if (fresh.closedAt) throw new BadRequestException({ message: 'This test is closed', code: TEST_ERROR_CODES.TEST_CLOSED });

    const served = await this.prepareServe(exercise.id, exercise.type, exercise.config);
    const attempt = await this.prisma.attempt.create({
      data: {
        exerciseId: exercise.id,
        studentId,
        activityInstanceId: instance.id,
        maxScore: served.maxScore,
        itemOrder: served.itemOrder,
        served: (served.items ?? null) as unknown as Prisma.InputJsonValue,
        answers: {},
        closesAt: fresh.closesAt,
        status: AttemptStatus.IN_PROGRESS,
      },
    });

    const policy = resolveTestPolicy(exercise.config as VocabularyTestConfig);
    return this.startedAttemptResponse(attempt, exercise, served.items, {}, fresh.closesAt, policy);
  }

  private async startSelfPaced(studentId: string, dto: StartAttemptDto) {
    const exerciseId = dto.exerciseId!; // guaranteed by zStartAttemptDto's refine
    const exercise = await this.prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new NotFoundException('Exercise not found');
    if (!ATTEMPTABLE_TYPES.includes(exercise.type)) {
      throw new BadRequestException(`${exercise.type} attempts are not started through this endpoint — it is a live-session activity`);
    }

    const policy = exercise.type === ActivityType.VOCABULARY_TEST ? resolveTestPolicy(exercise.config as VocabularyTestConfig) : null;

    if (ONE_SHOT_TYPES.includes(exercise.type)) {
      await this.assertTestStartable(studentId, exercise.id, dto.assignmentId);
    } else if (dto.assignmentId) {
      // VOCABULARY_TEST isn't in ONE_SHOT_TYPES, but an assignment must
      // still actually be this student's own — this was never checked
      // for non-one-shot types before.
      await this.assertAssignmentOwnership(studentId, exercise.id, dto.assignmentId);
    } else if (policy?.oneShot) {
      // A real timed/teacher-released test must not be openable as an
      // ungated self-study exercise — that would hand it an independent
      // deadline unrelated to (and possibly revealing before) any lab run
      // of the same test still in progress.
      throw new BadRequestException('This test can only be started from your assignments or a live session');
    }

    if (dto.assignmentId) {
      const resumable = await this.prisma.attempt.findFirst({
        where: { assignmentId: dto.assignmentId, studentId, status: AttemptStatus.IN_PROGRESS },
        orderBy: { startedAt: 'desc' },
      });
      if (resumable) return this.resumeAttemptResponse(resumable, exercise);
    }

    const served = await this.prepareServe(exercise.id, exercise.type, exercise.config);
    const closesAt =
      policy?.revealMode === 'ON_TIME_EXPIRY' && (exercise.config as VocabularyTestConfig).timeLimitSec
        ? new Date(Date.now() + (exercise.config as VocabularyTestConfig).timeLimitSec! * 1000)
        : null;

    const attempt = await this.prisma.attempt.create({
      data: {
        exerciseId: exercise.id,
        studentId,
        assignmentId: dto.assignmentId,
        maxScore: served.maxScore,
        itemOrder: served.itemOrder,
        served: (served.items ?? null) as unknown as Prisma.InputJsonValue,
        answers: {},
        closesAt,
        status: AttemptStatus.IN_PROGRESS,
      },
    });

    return this.startedAttemptResponse(attempt, exercise, served.items, {}, closesAt, policy);
  }

  private resumeAttemptResponse(
    attempt: { id: string; closesAt: Date | null; served: unknown; answers: unknown },
    exercise: { id: string; type: ActivityType; title: string; config: unknown; dictionaryEnabled: boolean | null },
  ) {
    const policy = exercise.type === ActivityType.VOCABULARY_TEST ? resolveTestPolicy(exercise.config as VocabularyTestConfig) : null;
    const items = (attempt.served as unknown as ServedItem[] | null) ?? undefined;
    const answers = (attempt.answers as Record<string, string> | null) ?? {};
    return this.startedAttemptResponse(attempt, exercise, items, answers, attempt.closesAt, policy);
  }

  private startedAttemptResponse(
    attempt: { id: string },
    exercise: { id: string; type: ActivityType; title: string; config: unknown; dictionaryEnabled: boolean | null },
    items: ServedItem[] | undefined,
    answers: Record<string, string>,
    closesAt: Date | null,
    policy: VocabPolicy | null,
  ) {
    return {
      attemptId: attempt.id,
      exercise: {
        id: exercise.id,
        type: exercise.type,
        title: exercise.title,
        // SPEC-mcq-test-timed-reveal.md §3.2 (GF-6): the config a station
        // holds must never carry an answer key. For VOCABULARY_TEST this
        // strips items/itemBankId entirely — the questions themselves
        // only ever travel through `items` below (already answer-stripped
        // per-attempt), never through the raw exercise config.
        config: projectConfigForStation(exercise.type, exercise.config),
        // Offline dictionary (SPEC-offline-dictionary.md §7) — the client
        // hides its dictionary panel while this is false (server-side
        // enforcement is DictionaryPolicyService, independent of this).
        dictionaryEnabled: resolveDictionaryEnabled(exercise.type, exercise.dictionaryEnabled),
      },
      items, // answer keys already stripped — see prepareServe
      answers,
      timing: policy
        ? {
            closesAt: closesAt ? closesAt.getTime() : null,
            serverNow: Date.now(),
            revealMode: policy.revealMode,
            revealDetail: policy.revealDetail,
            allowReview: policy.allowReview,
          }
        : null,
    };
  }

  /** See ONE_SHOT_TYPES: started only through the student's own
   * Assignment, locked once submitted — a re-take needs the teacher to
   * send it again (a fresh Assignment). */
  private async assertTestStartable(studentId: string, exerciseId: string, assignmentId?: string): Promise<void> {
    if (!assignmentId) throw new BadRequestException('A test can only be started from your assignments');
    await this.assertAssignmentOwnership(studentId, exerciseId, assignmentId);
    const submitted = await this.prisma.attempt.count({
      where: { assignmentId, status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.SCORED] } },
    });
    if (submitted > 0) throw new BadRequestException('You have already submitted this test');
  }

  private async assertAssignmentOwnership(studentId: string, exerciseId: string, assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.studentId !== studentId || assignment.exerciseId !== exerciseId) {
      throw new ForbiddenException('This test is not assigned to you');
    }
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
      // Inline choices are shuffled too now — they never were before,
      // which meant an inline MCQ (stored answer-first, same as a bank
      // item) always served the correct answer in slot one.
      items: order.map((idx) => ({ id: `inline:${idx}`, prompt: items[idx]!.prompt, choices: shuffleChoices(items[idx]!.choices ?? []) })),
    };
  }

  // ---- Scoring (submit) ----------------------------------------------------

  /** VOCABULARY_TEST only (SPEC-mcq-test-timed-reveal.md). Routed through
   * the atomic finalizeVocabAttempt rather than the read-then-write path
   * every other type still uses, so a student's own submit racing the
   * close scheduler's auto-submit can never double-grade. */
  private async submitVocab(
    attempt: { id: string; status: string; exercise: { type: ActivityType } },
    studentId: string,
    dto: SubmitAttemptDto,
  ) {
    const descriptor = getActivity(attempt.exercise.type);
    const responseResult = descriptor.responseSchema.safeParse(dto.response);
    if (!responseResult.success) {
      throw new BadRequestException({ message: 'Invalid response payload for this activity type', issues: responseResult.error.issues });
    }
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException({ message: `Attempt is already ${attempt.status.toLowerCase()}`, code: TEST_ERROR_CODES.ALREADY_SUBMITTED });
    }

    const answers = dto.itemResponses?.length ? Object.fromEntries(dto.itemResponses.map((r) => [r.itemId, r.given])) : undefined;
    const outcome = await this.finalizeVocabAttempt(attempt.id, { answers, enforceDeadline: true, now: new Date() });
    if (!outcome) {
      const fresh = await this.prisma.attempt.findUnique({ where: { id: attempt.id }, select: { status: true } });
      if (fresh?.status !== AttemptStatus.IN_PROGRESS) {
        throw new BadRequestException({ message: `Attempt is already ${fresh?.status.toLowerCase()}`, code: TEST_ERROR_CODES.ALREADY_SUBMITTED });
      }
      throw new BadRequestException({ message: 'This test is closed', code: TEST_ERROR_CODES.TEST_CLOSED });
    }
    return this.getResult(attempt.id, studentId);
  }

  /**
   * Shared by a student's own submit (enforceDeadline: true — must run
   * before closesAt) and TestCloseService's auto-submit (enforceDeadline:
   * false — the instance already decided it's time, or this is a lazy
   * finalize on a result fetch past the deadline). One atomic conditional
   * transition (IN_PROGRESS -> SCORED) via `updateMany`: whichever caller's
   * UPDATE actually matches the row wins the race; the other gets
   * `count: 0` and returns null having changed nothing — no double
   * ItemResponse rows, no double SkillProgress, no double audit entry.
   */
  private async finalizeVocabAttempt(
    attemptId: string,
    opts: { answers?: Record<string, string>; enforceDeadline: boolean; now: Date },
  ): Promise<{ rawScore: number } | null> {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { exercise: true } });
    if (!attempt || attempt.status !== AttemptStatus.IN_PROGRESS) return null;

    const answers = opts.answers ?? (attempt.answers as Record<string, string> | null) ?? {};
    const answerKey = await this.resolveAnswerKey(attempt.itemOrder, attempt.exercise.type, attempt.exercise.config);
    const { rawScore, responseRows } = gradeVocab(
      attempt.itemOrder,
      new Map([...answerKey].map(([id, v]) => [id, v.answer])),
      answers,
    );

    const policy = resolveTestPolicy(attempt.exercise.config as VocabularyTestConfig);
    const revealAt =
      policy.revealMode === 'ON_SUBMIT' ? opts.now : policy.revealMode === 'ON_TIME_EXPIRY' ? (attempt.closesAt ?? opts.now) : null; // ON_TEACHER_RELEASE — set later by an explicit release

    const guard: Record<string, unknown> = { id: attemptId, status: AttemptStatus.IN_PROGRESS };
    if (opts.enforceDeadline) guard.OR = [{ closesAt: null }, { closesAt: { gt: opts.now } }];

    const result = await this.prisma.attempt.updateMany({
      where: guard,
      data: { rawScore, status: AttemptStatus.SCORED, submittedAt: opts.now, answers: answers as unknown as Prisma.InputJsonValue, revealAt },
    });
    if (result.count === 0) return null;

    const isBankMode = attempt.itemOrder.length === 0 || !attempt.itemOrder[0]!.startsWith('inline:');
    if (isBankMode) {
      await this.prisma.itemResponse.createMany({
        data: responseRows.map((r) => ({ attemptId, itemId: r.itemId, given: r.given, correct: r.correct, order: r.order })),
      });
    }
    if (attempt.itemOrder.length > 0) {
      await this.recordSkillProgress(attempt.studentId, attempt.exercise.type, rawScore, attempt.maxScore ?? 100);
    }
    await this.audit.log({ actorId: attempt.studentId, action: 'attempt.submit', detail: { attemptId, rawScore, status: AttemptStatus.SCORED } });

    return { rawScore };
  }

  /** Bank mode reads the key from Item; inline mode reads it from the
   * exercise's own config. Shared by finalizeVocabAttempt (scoring) and
   * getResult (showing the key after reveal). */
  private async resolveAnswerKey(
    itemOrder: string[],
    type: ActivityType,
    config: unknown,
  ): Promise<Map<string, { answer: string; explanation?: string }>> {
    if (itemOrder.length === 0) return new Map();
    const isBankMode = !itemOrder[0]!.startsWith('inline:');
    if (isBankMode) {
      const items = await this.prisma.item.findMany({ where: { id: { in: itemOrder } } });
      return new Map(items.map((i) => [i.id, { answer: i.answer, explanation: i.explanation ?? undefined }]));
    }
    const inlineItems = type === ActivityType.VOCABULARY_TEST ? ((config as VocabularyTestConfig).items ?? []) : [];
    return new Map(
      itemOrder.map((key) => {
        const item = inlineItems[Number(key.split(':')[1])];
        return [key, { answer: item?.answer ?? '', explanation: item?.explanation }];
      }),
    );
  }

  private maskAttemptRow<
    T extends {
      exercise: { type: ActivityType };
      status: string;
      rawScore: number | null;
      maxScore: number | null;
      revealAt: Date | null;
      scoreOverride: unknown;
    },
  >(a: T): T {
    if (a.exercise.type !== ActivityType.VOCABULARY_TEST || a.status !== AttemptStatus.SCORED) return a;
    const revealed = a.revealAt !== null && a.revealAt <= new Date();
    if (revealed) return a;
    return { ...a, status: AttemptStatus.SUBMITTED, rawScore: null, maxScore: null, scoreOverride: null };
  }

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

    if (exercise.type === ActivityType.LISTENING_TEST) {
      return this.scoreListeningTest(attempt, itemResponses);
    }

    throw new BadRequestException(`${exercise.type} is scored through submitVocab, not score()`);
  }

  /** Graded exactly like a bank-mode vocabulary test (same gradeVocab
   * logic), but NOT routed through the timed-reveal machinery —
   * LISTENING_TEST predates SPEC-mcq-test-timed-reveal.md, has no live/timed
   * player, and keeps its original "reveal immediately on submit" contract
   * (the plain updated Attempt row) so the existing ListeningTestPlayer
   * keeps working unchanged. */
  private async scoreListeningTest(
    attempt: { id: string; itemOrder: string[] },
    itemResponses: ItemResponseDto[],
  ): Promise<{ rawScore: number; status: string }> {
    if (attempt.itemOrder.length === 0) return { rawScore: 0, status: AttemptStatus.SCORED };
    const items = await this.prisma.item.findMany({ where: { id: { in: attempt.itemOrder } } });
    const answerKey = new Map(items.map((i) => [i.id, i.answer]));
    const answers = Object.fromEntries(itemResponses.map((r) => [r.itemId, r.given]));
    const { rawScore, responseRows } = gradeVocab(attempt.itemOrder, answerKey, answers);
    await this.prisma.itemResponse.createMany({
      data: responseRows.map((r) => ({ attemptId: attempt.id, itemId: r.itemId, given: r.given, correct: r.correct, order: r.order })),
    });
    return { rawScore, status: AttemptStatus.SCORED };
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

/** Pure grading — shared by finalizeVocabAttempt (both a student's own
 * submit and the close scheduler's auto-submit go through it, so there is
 * exactly one place "is this answer correct" is decided). `answers` is
 * itemId -> given. */
export function gradeVocab(
  itemOrder: string[],
  answerKey: Map<string, string>,
  answers: Record<string, string>,
): { rawScore: number; responseRows: Array<{ itemId: string; given: string; correct: boolean; order: number }> } {
  if (itemOrder.length === 0) return { rawScore: 0, responseRows: [] };
  let correctCount = 0;
  const responseRows = itemOrder.map((itemId, order) => {
    const given = answers[itemId] ?? '';
    const correctAnswer = answerKey.get(itemId) ?? '';
    const correct = normalize(given) === normalize(correctAnswer);
    if (correct) correctCount += 1;
    return { itemId, given, correct, order };
  });
  const rawScore = Math.round((correctCount / itemOrder.length) * 100);
  return { rawScore, responseRows };
}
