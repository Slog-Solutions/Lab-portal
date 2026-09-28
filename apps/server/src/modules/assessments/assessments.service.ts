import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AssetKind,
  AttemptStatus,
  ItemType,
  MediaAssetScope,
  NO_WRITTEN_FEEDBACK,
  UserRole,
  type CreateAssessmentDto,
  type GradeAssessmentDto,
  type ItemDto,
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
        data: { teacherId, type: dto.type, title: dto.title, config: {}, dictionaryEnabled: dto.dictionaryEnabled },
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
        })),
      });
      // Vocabulary tests point at their bank by id, so the config can only
      // be final once the bank exists — validate it here, inside the
      // transaction, so a rejected config rolls the whole thing back.
      const finalConfig = this.validateConfig(dto.type, dto.type === ActivityType.VOCABULARY_TEST ? { ...config, itemBankId: bank.id } : config);
      await tx.exercise.update({ where: { id: created.id }, data: { config: finalConfig as Prisma.InputJsonValue } });
      await tx.assignment.createMany({
        data: studentIds.map((studentId) => ({ teacherId, studentId, exerciseId: created.id, dueAt: dto.dueAt, batchId: dto.batchId })),
      });
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
   * newest first, with progress. Only exercises that were actually assigned
   * to someone — an unassigned vocabulary exercise from the Exercises page is
   * not an assignment yet. */
  async list(requester: Requester, type: ActivityType) {
    if (!ASSESSMENT_TYPES.includes(type)) throw new BadRequestException(`${type} is not an assignment type`);
    const exercises = await this.prisma.exercise.findMany({
      where: {
        type,
        assignments: { some: {} },
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
      };
    });
  }

  /** Everything the results page needs in one round trip: the questions
   * (with the answer key — this is the teacher's view) and, per assigned
   * student, their submitted attempt (or latest attempt) with what they
   * gave. For a writing test `given` is the essay itself. */
  async get(id: string, requester: Requester) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: {
        teacher: { select: { fullName: true } },
        itemBank: { include: { items: { orderBy: { order: 'asc' } } } },
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
      questions: (exercise.itemBank?.items ?? []).map((i) => ({
        id: i.id,
        prompt: i.prompt,
        // A writing prompt or a reading passage has no key; don't ship an empty string as one.
        answer: hasNoAnswerKey ? null : i.answer,
        choices: i.choices,
        // Set only for a reading test whose teacher uploaded a PDF instead of (or alongside) typing a passage.
        mediaAssetId: i.mediaAssetId ?? undefined,
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
            responses: attempt.itemResponses.map((r) => ({ itemId: r.itemId, given: r.given, correct: r.correct })),
            override: attempt.scoreOverride,
          },
        };
      }),
    };
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
        const items = this.parseQuestions(dto.wordListText);
        return {
          items,
          // A sample as large as the bank is just "all of it" — don't store it.
          config: { shuffleItems: true, ...(dto.sampleSize && dto.sampleSize < items.length ? { sampleSize: dto.sampleSize } : {}) },
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
