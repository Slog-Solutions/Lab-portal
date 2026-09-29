import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  AssetKind,
  ItemType,
  MediaAssetScope,
  NO_WRITTEN_FEEDBACK,
  UserRole,
  type CreateAssessmentDto,
  type GradeAssessmentDto,
  type ItemDto,
  type UpdateVocabTestDto,
  type VocabQuestionInput,
  type VocabularyTestConfig,
} from '@lab/shared';
import { getActivity } from '@lab/shared/activities';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { BatchAccessService } from '../batches/batch-access.service';
import { GradebookService } from '../gradebook/gradebook.service';
import { parseWordListText } from '../exercises/word-list-parser';

/** The types the "Create Assignment" pages author. */
export const ASSESSMENT_TYPES: ActivityType[] = [
  ActivityType.VOCABULARY_TEST,
  ActivityType.WRITING_TEST,
  ActivityType.LISTENING_TEST,
  ActivityType.READING_TEST,
];

/** The types a teacher marks by hand, through this module's grade() — the
 * rest score themselves at submit time (AttemptsService.score). */
const HAND_MARKED_TYPES: ActivityType[] = [ActivityType.WRITING_TEST, ActivityType.READING_TEST];

const MAX_QUESTIONS = 200;

type Requester = { id: string; role: string };

/**
 * Teacher-created assignments — vocabulary, writing, listening and reading
 * tests. Each is an ordinary Exercise whose questions are ItemBank items, so
 * the existing Assignment -> Attempt -> ItemResponse pipeline (and the
 * Gradebook that reads it) works unchanged; this service only adds the
 * one-call authoring, the results view and, for the types that cannot score
 * themselves, grading. Same shape as PronunciationTestsService.
 *
 *   - vocabulary / listening: auto-scored on submit by AttemptsService.
 *   - writing / reading: the essay (or the student's recording id) is
 *     stored as ItemResponse.given and the attempt waits in SUBMITTED until
 *     a teacher grades it, through GradebookService.override() like every
 *     other teacher-assessed score (so it is audited the same way).
 *
 * SPEC-mcq-test-timed-reveal.md (§7.1) adds the form-style builder for
 * VOCABULARY_TEST — `dto.questions` alongside the original `wordListText`
 * import — plus `update()` (blocked once any attempt or lab run exists),
 * `releaseResults()` (the ON_TEACHER_RELEASE manual step for the
 * assignment/individual path — a launched lab run's own release goes
 * through TimedTestsService/TestCloseService.release instead), and
 * `get()`'s `settings`/`editable`/`labRuns` additions.
 */
@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gradebook: GradebookService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  async create(user: JwtPayload, dto: CreateAssessmentDto) {
    const teacherId = user.sub;
    const studentIds = [...new Set(dto.studentIds)];
    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds }, role: UserRole.STUDENT, active: true },
      select: { id: true },
    });
    if (students.length !== studentIds.length) {
      const found = new Set(students.map((s) => s.id));
      throw new BadRequestException(`Not active students: ${studentIds.filter((id) => !found.has(id)).join(', ')}`);
    }

    if (dto.batchId) await this.assertClassRoster(user, dto.batchId, studentIds);

    const { items, config } = await this.build(dto);

    // One transaction: a test that exists without its questions, or
    // without its assignments, is unusable and confusing to clean up by hand.
    const exercise = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exercise.create({
        data: {
          teacherId,
          type: dto.type,
          title: dto.title,
          config: {},
          dictionaryEnabled: dto.dictionaryEnabled,
          // SPEC-mcq-test-timed-reveal.md §6.1 "save without assigning" —
          // true regardless of studentIds.length, so a test saved with no
          // students yet (meant for "Launch in lab" later) still shows up
          // in list().
          isAssessment: true,
        },
      });
      const bank = await tx.itemBank.create({ data: { exerciseId: created.id } });
      await tx.item.createMany({
        data: items.map((item, order) => ({
          itemBankId: bank.id,
          order,
          type: item.type,
          prompt: item.prompt,
          answer: item.answer,
          choices: item.choices ?? [],
          mediaAssetId: item.mediaAssetId ?? null,
          explanation: item.explanation ?? null,
        })),
      });
      // Vocabulary tests point at their bank by id, so the config can only
      // be final once the bank exists — validate it here, inside the
      // transaction, so a rejected config rolls the whole thing back.
      const finalConfig = this.validateConfig(dto.type, dto.type === ActivityType.VOCABULARY_TEST ? { ...config, itemBankId: bank.id } : config);
      await tx.exercise.update({ where: { id: created.id }, data: { config: finalConfig as Prisma.InputJsonValue } });
      if (studentIds.length > 0) {
        await tx.assignment.createMany({
          data: studentIds.map((studentId) => ({ teacherId, studentId, exerciseId: created.id, dueAt: dto.dueAt, batchId: dto.batchId })),
        });
      }
      return created;
    });

    await this.audit.log({
      actorId: teacherId,
      action: 'assessment.create',
      detail: { exerciseId: exercise.id, type: dto.type, questions: items.length, students: studentIds.length, batchId: dto.batchId },
    });
    return { exerciseId: exercise.id, type: dto.type, questionCount: items.length, assigned: studentIds.length };
  }

  /** An assignment created from a class (My Classes -> Create Assignment)
   * is filed under it for the students' class history, so the teacher must
   * teach that class and every student must be in it. */
  private async assertClassRoster(user: JwtPayload, batchId: string, studentIds: string[]): Promise<void> {
    await this.batchAccess.assertCanUseBatch(user, batchId);
    const enrolled = await this.prisma.enrollment.count({ where: { batchId, userId: { in: studentIds } } });
    if (enrolled !== studentIds.length) {
      throw new BadRequestException('Some of these students are not in this class');
    }
  }

  /** The requester's own assignments of one type (an admin sees everyone's),
   * newest first, with progress. Includes a VOCABULARY_TEST saved with no
   * students yet (isAssessment, §6.1 "save without assigning") alongside
   * every exercise that has real assignments. */
  async list(requester: Requester, type: ActivityType) {
    if (!ASSESSMENT_TYPES.includes(type)) throw new BadRequestException(`${type} is not an assignment type`);
    const exercises = await this.prisma.exercise.findMany({
      where: {
        type,
        OR: [{ assignments: { some: {} } }, { isAssessment: true }],
        ...(requester.role === UserRole.ADMIN ? {} : { teacherId: requester.id }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: { select: { fullName: true } },
        itemBank: { select: { _count: { select: { items: true } } } },
        assignments: {
          select: {
            id: true,
            attempts: { select: { status: true, rawScore: true, maxScore: true }, orderBy: { startedAt: 'desc' } },
          },
        },
        _count: { select: { activityInstances: true } },
      },
    });

    return exercises.map((ex) => {
      const done = (status: string) => status === AttemptStatus.SUBMITTED || status === AttemptStatus.SCORED;
      // Each assignment's latest scored attempt, as a percentage.
      const percents = ex.assignments.flatMap((a) => {
        const scored = a.attempts.find((t) => t.status === AttemptStatus.SCORED && t.rawScore !== null && t.maxScore);
        return scored ? [(scored.rawScore! / scored.maxScore!) * 100] : [];
      });
      return {
        id: ex.id,
        type: ex.type,
        title: ex.title,
        createdAt: ex.createdAt,
        teacherName: ex.teacher.fullName,
        questionCount: ex.itemBank?._count.items ?? 0,
        assigned: ex.assignments.length,
        submitted: ex.assignments.filter((a) => a.attempts.some((t) => done(t.status))).length,
        toGrade: ex.assignments.filter(
          (a) => a.attempts.some((t) => t.status === AttemptStatus.SUBMITTED) && !a.attempts.some((t) => t.status === AttemptStatus.SCORED),
        ).length,
        averageScore: percents.length ? Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length) : null,
        labRunCount: ex._count.activityInstances,
      };
    });
  }

  /** Everything the results page needs in one round trip: the questions
   * (with the answer key — this is the teacher's view) and, per assigned
   * student, their submitted attempt (or latest attempt) with what they
   * gave. For a writing test `given` is the essay itself. Also: this
   * test's builder settings, whether it's still `editable` (§7.1's edit
   * mode, blocked once any real attempt or lab run exists — same hazard
   * as ExercisesService.setItems's own guard), and every "Launch in lab"
   * run (`labRuns`), which the assignment-keyed `assignments[]` below
   * never surfaces (a lab attempt has no assignmentId). */
  async get(id: string, requester: Requester) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: {
        teacher: { select: { fullName: true } },
        itemBank: { include: { items: { orderBy: { order: 'asc' } } } },
        _count: { select: { attempts: true, activityInstances: true } },
      },
    });
    if (!exercise || !ASSESSMENT_TYPES.includes(exercise.type)) throw new NotFoundException('Assignment not found');
    this.assertOwnerOrAdmin(exercise, requester);

    const assignments = await this.prisma.assignment.findMany({
      where: { exerciseId: id },
      include: { student: { select: { id: true, fullName: true, serviceNumber: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const attempts = await this.prisma.attempt.findMany({
      where: { exerciseId: id, assignmentId: { in: assignments.map((a) => a.id) } },
      include: {
        itemResponses: { orderBy: { order: 'asc' }, select: { itemId: true, given: true, correct: true } },
        scoreOverride: { select: { newScore: true, reason: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    // Neither a writing prompt nor a reading passage has a key.
    const hasNoAnswerKey = exercise.type === ActivityType.WRITING_TEST || exercise.type === ActivityType.READING_TEST;
    const isVocab = exercise.type === ActivityType.VOCABULARY_TEST;
    const vocabConfig = isVocab ? (exercise.config as VocabularyTestConfig) : null;

    return {
      id: exercise.id,
      type: exercise.type,
      title: exercise.title,
      createdAt: exercise.createdAt,
      teacherName: exercise.teacher.fullName,
      config: exercise.config as {
        instructions?: string;
        minWords?: number;
        maxWords?: number;
        audioAssetId?: string;
        voice?: 'en_US' | 'en_GB';
      },
      settings: vocabConfig
        ? {
            timeLimitSec: vocabConfig.timeLimitSec,
            revealMode: vocabConfig.revealMode,
            revealDetail: vocabConfig.revealDetail,
            allowReview: vocabConfig.allowReview,
            sampleSize: vocabConfig.sampleSize,
          }
        : undefined,
      // §7.1's builder can only re-edit a test that has no real attempts
      // and was never launched — editing the item bank underneath would
      // otherwise orphan a past attempt's itemOrder/ItemResponse rows
      // (same hazard ExercisesService.setItems guards against).
      editable: exercise._count.attempts === 0 && exercise._count.activityInstances === 0,
      questions: (exercise.itemBank?.items ?? []).map((i) => ({
        id: i.id,
        prompt: i.prompt,
        // A writing prompt or a reading passage has no key; don't ship an empty string as one.
        answer: hasNoAnswerKey ? null : i.answer,
        choices: i.choices,
        // Set only for a reading test whose teacher uploaded a PDF instead of (or alongside) typing a passage.
        mediaAssetId: i.mediaAssetId ?? undefined,
        explanation: i.explanation ?? undefined,
        // The builder's own shape (options[correctIndex]) — derived, not
        // stored: `choices` is authored order, so the correct answer's
        // position in it IS correctIndex.
        correctIndex: !hasNoAnswerKey && i.choices.length > 0 ? i.choices.indexOf(i.answer) : undefined,
      })),
      assignments: assignments.map((a) => {
        const mine = attempts.filter((t) => t.assignmentId === a.id);
        // Newest first, so this is the latest finished attempt (a retryable
        // vocabulary test can have several); otherwise show the latest one.
        const attempt = mine.find((t) => t.status === AttemptStatus.SUBMITTED || t.status === AttemptStatus.SCORED) ?? mine[0] ?? null;
        return {
          assignmentId: a.id,
          dueAt: a.dueAt,
          student: a.student,
          attempt: attempt && {
            id: attempt.id,
            status: attempt.status,
            rawScore: attempt.rawScore,
            maxScore: attempt.maxScore,
            submittedAt: attempt.submittedAt,
            revealAt: attempt.revealAt,
            responses: attempt.itemResponses.map((r) => ({ itemId: r.itemId, given: r.given, correct: r.correct })),
            override: attempt.scoreOverride,
          },
        };
      }),
      labRuns: isVocab ? await this.labRunsFor(id) : [],
    };
  }

  /** "Launch in lab" runs of this test — keyed by ActivityInstance, not
   * Assignment (a lab attempt has no assignmentId), so assignments[]
   * above never shows them. Teacher view: full detail regardless of
   * reveal state (§6.4), same as AttemptsService.getResult's staff mode. */
  private async labRunsFor(exerciseId: string) {
    const instances = await this.prisma.activityInstance.findMany({
      where: { exerciseId },
      include: {
        group: { select: { sessionId: true, session: { select: { title: true, state: true } } } },
        attempts: { include: { student: { select: { id: true, fullName: true } } } },
      },
      orderBy: { startedAt: 'desc' },
    });
    return instances.map((instance) => ({
      activityInstanceId: instance.id,
      sessionId: instance.group.sessionId,
      sessionTitle: instance.group.session.title,
      startedAt: instance.startedAt,
      status: instance.closedAt ? ('CLOSED' as const) : instance.group.session.state === 'ARMED' ? ('READY' as const) : ('OPEN' as const),
      closesAt: instance.closesAt,
      revealedAt: instance.revealedAt,
      attempts: instance.attempts.map((a) => ({
        student: a.student,
        status: a.status,
        rawScore: a.rawScore,
        maxScore: a.maxScore,
        revealAt: a.revealAt,
        answers: (a.answers as Record<string, string> | null) ?? {},
      })),
    }));
  }

  /** SPEC-mcq-test-timed-reveal.md §7.1 — re-edit a saved test's questions
   * and/or settings. Refused once editable is false (see get()'s own
   * comment). Questions and settings are independent: a settings-only
   * patch (e.g. just raising the time limit) leaves the item bank alone. */
  async update(id: string, dto: UpdateVocabTestDto, requester: Requester) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: { _count: { select: { attempts: true, activityInstances: true } } },
    });
    if (!exercise || exercise.type !== ActivityType.VOCABULARY_TEST) throw new NotFoundException('Test not found');
    this.assertOwnerOrAdmin(exercise, requester);
    if (exercise._count.attempts > 0 || exercise._count.activityInstances > 0) {
      throw new ConflictException('This test already has attempts or a lab run, so it can no longer be edited — duplicate it instead');
    }
    if (dto.wordListText && dto.questions?.length) {
      throw new BadRequestException('Provide either wordListText or questions, not both');
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.questions?.length || dto.wordListText) {
        const items = dto.questions?.length ? this.questionsToItems(dto.questions) : this.parseQuestions(dto.wordListText!);
        const bank = await tx.itemBank.upsert({ where: { exerciseId: id }, create: { exerciseId: id }, update: {} });
        await tx.item.deleteMany({ where: { itemBankId: bank.id } });
        await tx.item.createMany({
          data: items.map((item, order) => ({
            itemBankId: bank.id,
            order,
            type: item.type,
            prompt: item.prompt,
            answer: item.answer,
            choices: item.choices ?? [],
            mediaAssetId: item.mediaAssetId ?? null,
            explanation: item.explanation ?? null,
          })),
        });
      }

      const current = exercise.config as VocabularyTestConfig;
      const nextConfig = this.validateConfig(ActivityType.VOCABULARY_TEST, {
        ...current,
        sampleSize: dto.sampleSize ?? current.sampleSize,
        timeLimitSec: dto.timeLimitSec ?? current.timeLimitSec,
        revealMode: dto.revealMode ?? current.revealMode,
        revealDetail: dto.revealDetail ?? current.revealDetail,
        allowReview: dto.allowReview ?? current.allowReview,
      });
      await tx.exercise.update({
        where: { id },
        data: {
          title: dto.title,
          config: nextConfig as Prisma.InputJsonValue,
          dictionaryEnabled: dto.dictionaryEnabled,
        },
      });
    });

    await this.audit.log({ actorId: requester.id, action: 'assessment.update', detail: { exerciseId: id } });
    return this.get(id, requester);
  }

  /** The ON_TEACHER_RELEASE manual step for the assignment/individual path
   * only — a launched lab run's release goes through
   * TimedTestsService/TestCloseService.release instead (it also has to
   * republish snapshots and emit test:revealed, which this service has no
   * business doing). Idempotent: only SCORED-and-unrevealed rows match. */
  async releaseResults(id: string, requester: Requester): Promise<{ ok: true; released: number }> {
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise || exercise.type !== ActivityType.VOCABULARY_TEST) throw new NotFoundException('Test not found');
    this.assertOwnerOrAdmin(exercise, requester);
    const result = await this.prisma.attempt.updateMany({
      where: { exerciseId: id, activityInstanceId: null, status: AttemptStatus.SCORED, revealAt: null },
      data: { revealAt: new Date() },
    });
    await this.audit.log({ actorId: requester.id, action: 'assessment.release', detail: { exerciseId: id, released: result.count } });
    return { ok: true, released: result.count };
  }

  /** Marks one submitted writing or reading test. Re-grading is allowed (the
   * gradebook's override keeps only the current value; every edit is in the
   * audit log). The other types score themselves, so they are refused. */
  async grade(requester: Requester, attemptId: string, dto: GradeAssessmentDto) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { exercise: { select: { type: true, teacherId: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!HAND_MARKED_TYPES.includes(attempt.exercise.type)) {
      throw new BadRequestException('Only writing and reading tests are marked by hand — the other types score themselves');
    }
    this.assertOwnerOrAdmin(attempt.exercise, requester);
    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('The student has not submitted this test yet');
    }
    return this.gradebook.override(requester.id, { attemptId, newScore: dto.score, reason: dto.feedback || NO_WRITTEN_FEEDBACK });
  }

  // ---- Authoring ----------------------------------------------------------

  /** Turns the type-specific half of the DTO into questions + a config
   * (minus the vocabulary bank id, which only exists once the bank does). */
  private async build(dto: CreateAssessmentDto): Promise<{ items: ItemDto[]; config: Record<string, unknown> }> {
    switch (dto.type) {
      case ActivityType.VOCABULARY_TEST: {
        // Exactly one of these is required — a discriminated union branch
        // can't carry a cross-field .refine() (see the READING_TEST branch
        // below for the same pattern).
        if (!dto.wordListText && !dto.questions?.length) {
          throw new BadRequestException('Add at least one question, either typed in the builder or imported as a word list');
        }
        const items = dto.questions?.length ? this.questionsToItems(dto.questions) : this.parseQuestions(dto.wordListText!);
        if (dto.questions?.length && items.length > MAX_QUESTIONS) {
          throw new BadRequestException(`At most ${MAX_QUESTIONS} questions per assignment (you have ${items.length})`);
        }
        return {
          items,
          config: {
            shuffleItems: true,
            // A sample as large as the bank is just "all of it" — don't store it.
            ...(dto.sampleSize && dto.sampleSize < items.length ? { sampleSize: dto.sampleSize } : {}),
            ...(dto.timeLimitSec ? { timeLimitSec: dto.timeLimitSec } : {}),
            revealMode: dto.revealMode,
            revealDetail: dto.revealDetail,
            allowReview: dto.allowReview,
          },
        };
      }
      case ActivityType.WRITING_TEST: {
        this.validateConfig(dto.type, { instructions: dto.instructions, minWords: dto.minWords, maxWords: dto.maxWords });
        return {
          // A writing prompt has no answer key; Item.answer is required, so it is empty.
          items: [{ type: ItemType.SHORT_ANSWER, prompt: dto.prompt, answer: '' }],
          config: { instructions: dto.instructions, minWords: dto.minWords, maxWords: dto.maxWords },
        };
      }
      case ActivityType.LISTENING_TEST: {
        await this.assertStudentsCanHear(dto.audioAssetId);
        return {
          items: this.parseQuestions(dto.questionsText),
          config: { audioAssetId: dto.audioAssetId, instructions: dto.instructions },
        };
      }
      case ActivityType.READING_TEST: {
        const passage = dto.passage?.trim() ?? '';
        if (!passage && !dto.documentAssetId) {
          throw new BadRequestException('Give a passage to type, or upload a PDF for students to read');
        }
        if (dto.documentAssetId) await this.assertStudentsCanRead(dto.documentAssetId);
        this.validateConfig(dto.type, { instructions: dto.instructions, voice: dto.voice });
        return {
          // A passage has no answer key; Item.answer is required, so it is
          // empty. The document (if any) travels as this item's
          // mediaAssetId — the same field vocabulary items use for their
          // per-item audio — so ServedItem and the teacher's results page
          // pick it up with no new plumbing.
          items: [{ type: ItemType.SHORT_ANSWER, prompt: passage, answer: '', mediaAssetId: dto.documentAssetId }],
          config: { instructions: dto.instructions, voice: dto.voice },
        };
      }
    }
  }

  /** The form-builder's question shape (§7.1: prompt/options/correctIndex)
   * -> the item-bank's storage shape (prompt/answer/choices) — the correct
   * option becomes `answer`, every option (in authored order, including
   * the correct one) becomes `choices`, matching the same "MCQ choices
   * include the answer" shape the word-list importer already produces
   * (see parseWordListText / prepareServe's per-attempt shuffle). */
  private questionsToItems(questions: VocabQuestionInput[]): ItemDto[] {
    return questions.map((q) => ({
      type: ItemType.MCQ,
      prompt: q.prompt,
      answer: q.options[q.correctIndex]!,
      choices: q.options,
      explanation: q.explanation,
      mediaAssetId: q.mediaAssetId,
    }));
  }

  private parseQuestions(text: string): ItemDto[] {
    let items: ItemDto[];
    try {
      items = parseWordListText(text);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Could not read the question list');
    }
    if (items.length > MAX_QUESTIONS) throw new BadRequestException(`At most ${MAX_QUESTIONS} questions per assignment (you have ${items.length})`);
    return items;
  }

  /** Students fetch the clip with their seat's token, and a PRIVATE asset is
   * readable only by its owner (MediaAssetsService.assertReadable) — so a
   * private clip would save fine and then fail to play on every student's
   * console. Refuse it here, and never widen its visibility silently. */
  private async assertStudentsCanHear(assetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { kind: true, scope: true } });
    if (!asset) throw new BadRequestException('That audio file was not found');
    if (asset.kind !== AssetKind.AUDIO) throw new BadRequestException('The selected file is not audio');
    if (asset.scope === MediaAssetScope.PRIVATE) {
      throw new BadRequestException('That audio is private, so students could not play it — share it (Department or Institution) in the Media Library first');
    }
  }

  /** Students fetch the document with their seat's token the same way they
   * fetch a listening clip, so the same PRIVATE-asset trap applies (see
   * assertStudentsCanHear). Restricted to an actual PDF — the student
   * player embeds it as one (AssetViewer's 'pdf' case), unconditionally,
   * since there's no per-item metadata fetch to detect the real kind. */
  private async assertStudentsCanRead(assetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { mimeType: true, scope: true } });
    if (!asset) throw new BadRequestException('That document was not found');
    if (asset.mimeType !== 'application/pdf') throw new BadRequestException('The selected file is not a PDF');
    if (asset.scope === MediaAssetScope.PRIVATE) {
      throw new BadRequestException('That document is private, so students could not open it — share it (Department or Institution) in the Media Library first');
    }
  }

  private validateConfig(type: ActivityType, config: unknown): unknown {
    const result = getActivity(type).configSchema.safeParse(config);
    if (!result.success) {
      throw new BadRequestException({ message: `Invalid config for ${type}`, issues: result.error.issues });
    }
    return result.data;
  }

  private assertOwnerOrAdmin(exercise: { teacherId: string }, requester: Requester): void {
    if (requester.role === UserRole.ADMIN || exercise.teacherId === requester.id) return;
    throw new ForbiddenException('This assignment belongs to another teacher');
  }
}
