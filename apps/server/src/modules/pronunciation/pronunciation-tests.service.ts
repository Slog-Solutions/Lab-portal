import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  ItemType,
  UserRole,
  type CreatePronunciationTestDto,
  type GradePronunciationTestDto,
} from '@lab/shared';
import { getActivity } from '@lab/shared/activities';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GradebookService } from '../gradebook/gradebook.service';

/** A word rated at or above this counts as "correct" on the ItemResponse
 * row, purely so existing per-item views that read `correct` still make
 * sense — the real result is the 1-5 `score`. */
const PASSING_RATING = 3;

/**
 * Teacher-run pronunciation tests (Ser 7). A test is an ordinary Exercise
 * of type PRONUNCIATION_TEST whose words are ItemBank items, so the whole
 * existing Assignment -> Attempt -> Recording -> ScoreOverride pipeline
 * (and the Gradebook that reads it) works unchanged — this service only
 * adds the authoring/results/grading conveniences that pipeline lacks.
 * Per word, ItemResponse.given holds the student's Recording id and
 * ItemResponse.score the teacher's 1-5 rating; the attempt's overall
 * score goes through GradebookService.override() like every other
 * teacher-assessed score, so it is audited the same way.
 */
@Injectable()
export class PronunciationTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gradebook: GradebookService,
  ) {}

  async create(teacherId: string, dto: CreatePronunciationTestDto) {
    const parsed = getActivity(ActivityType.PRONUNCIATION_TEST).configSchema.safeParse({
      instructions: dto.instructions,
      playModelAudio: dto.playModelAudio,
      voice: dto.voice,
    });
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid pronunciation test config', issues: parsed.error.issues });
    }

    const studentIds = [...new Set(dto.studentIds)];
    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds }, role: UserRole.STUDENT, active: true },
      select: { id: true },
    });
    if (students.length !== studentIds.length) {
      const found = new Set(students.map((s) => s.id));
      const missing = studentIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Not active students: ${missing.join(', ')}`);
    }

    // One transaction: a test that exists without its words, or without
    // its assignments, is unusable and confusing to clean up by hand.
    const exercise = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exercise.create({
        data: {
          teacherId,
          type: ActivityType.PRONUNCIATION_TEST,
          title: dto.title,
          config: parsed.data as Prisma.InputJsonValue,
        },
      });
      const bank = await tx.itemBank.create({ data: { exerciseId: created.id } });
      await tx.item.createMany({
        data: dto.words.map((word, order) => ({
          itemBankId: bank.id,
          order,
          type: ItemType.SHORT_ANSWER,
          prompt: word,
          answer: word,
        })),
      });
      await tx.assignment.createMany({
        data: studentIds.map((studentId) => ({ teacherId, studentId, exerciseId: created.id, dueAt: dto.dueAt })),
      });
      return created;
    });

    await this.audit.log({
      actorId: teacherId,
      action: 'pronunciation_test.create',
      detail: { exerciseId: exercise.id, words: dto.words.length, students: studentIds.length },
    });
    return { exerciseId: exercise.id, wordCount: dto.words.length, assigned: studentIds.length };
  }

  /** Every test with its progress counts. Lab-wide, like ExercisesService.list —
   * exercises are shared teaching material. */
  async list() {
    const exercises = await this.prisma.exercise.findMany({
      where: { type: ActivityType.PRONUNCIATION_TEST },
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: { select: { fullName: true } },
        itemBank: { select: { _count: { select: { items: true } } } },
        assignments: { select: { id: true, attempts: { select: { status: true } } } },
      },
    });
    return exercises.map((ex) => ({
      id: ex.id,
      title: ex.title,
      createdAt: ex.createdAt,
      teacherName: ex.teacher.fullName,
      wordCount: ex.itemBank?._count.items ?? 0,
      assigned: ex.assignments.length,
      submitted: ex.assignments.filter((a) =>
        a.attempts.some((t) => t.status === AttemptStatus.SUBMITTED || t.status === AttemptStatus.SCORED),
      ).length,
      graded: ex.assignments.filter((a) => a.attempts.some((t) => t.status === AttemptStatus.SCORED)).length,
    }));
  }

  /** Everything the results page needs in one round trip: the words, and
   * per assigned student their submitted attempt (or latest attempt) with
   * each word's recording id and rating. */
  async get(id: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: { itemBank: { include: { items: { orderBy: { order: 'asc' } } } } },
    });
    if (!exercise || exercise.type !== ActivityType.PRONUNCIATION_TEST) {
      throw new NotFoundException('Pronunciation test not found');
    }

    const assignments = await this.prisma.assignment.findMany({
      where: { exerciseId: id },
      include: { student: { select: { id: true, fullName: true, serviceNumber: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const attempts = await this.prisma.attempt.findMany({
      where: { exerciseId: id, assignmentId: { in: assignments.map((a) => a.id) } },
      include: {
        itemResponses: { orderBy: { order: 'asc' }, select: { itemId: true, given: true, score: true } },
        scoreOverride: { select: { newScore: true, reason: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    return {
      id: exercise.id,
      title: exercise.title,
      createdAt: exercise.createdAt,
      config: exercise.config as { instructions?: string; playModelAudio?: boolean; voice?: 'en_US' | 'en_GB' },
      words: (exercise.itemBank?.items ?? []).map((i) => ({ id: i.id, word: i.prompt })),
      assignments: assignments.map((a) => {
        const mine = attempts.filter((t) => t.assignmentId === a.id);
        // One submission per assignment is enforced, so at most one
        // attempt is ever SUBMITTED/SCORED; otherwise show the latest
        // (possibly abandoned IN_PROGRESS) one.
        const attempt =
          mine.find((t) => t.status === AttemptStatus.SUBMITTED || t.status === AttemptStatus.SCORED) ?? mine[0] ?? null;
        return {
          assignmentId: a.id,
          dueAt: a.dueAt,
          student: a.student,
          attempt: attempt && {
            id: attempt.id,
            status: attempt.status,
            rawScore: attempt.rawScore,
            submittedAt: attempt.submittedAt,
            responses: attempt.itemResponses.map((r) => ({ itemId: r.itemId, recordingId: r.given, score: r.score })),
            override: attempt.scoreOverride,
          },
        };
      }),
    };
  }

  /** Records the teacher's per-word 1-5 ratings and sets the attempt's
   * overall score to their average as a percentage. Re-grading is allowed
   * (the gradebook's override keeps only the current value; every edit is
   * in the audit log). */
  async grade(teacherId: string, attemptId: string, dto: GradePronunciationTestDto) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { exercise: { select: { type: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.exercise.type !== ActivityType.PRONUNCIATION_TEST) {
      throw new BadRequestException('This attempt is not a pronunciation test');
    }
    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('The student has not submitted this test yet');
    }

    const ratings = new Map<string, number>();
    for (const r of dto.ratings) {
      if (ratings.has(r.itemId)) throw new BadRequestException('A word was rated more than once');
      ratings.set(r.itemId, r.score);
    }
    const expected = new Set(attempt.itemOrder);
    for (const itemId of ratings.keys()) {
      if (!expected.has(itemId)) throw new BadRequestException('Rating for a word that is not in this test');
    }
    const unrated = attempt.itemOrder.filter((itemId) => !ratings.has(itemId)).length;
    if (unrated > 0) throw new BadRequestException(`Rate every word — ${unrated} still unrated`);

    await this.prisma.$transaction(
      [...ratings].map(([itemId, score]) =>
        this.prisma.itemResponse.updateMany({
          where: { attemptId, itemId },
          data: { score, correct: score >= PASSING_RATING },
        }),
      ),
    );

    const average = [...ratings.values()].reduce((sum, s) => sum + s, 0) / ratings.size;
    const newScore = Math.round((average / 5) * 100);
    return this.gradebook.override(teacherId, {
      attemptId,
      newScore,
      reason: dto.feedback || `Per-word pronunciation ratings, average ${average.toFixed(1)}/5`,
    });
  }
}
