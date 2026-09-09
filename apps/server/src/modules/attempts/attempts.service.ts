import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  type ItemResponseDto,
  type StartAttemptDto,
  type SubmitAttemptDto,
  type VocabularyTestConfig,
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
const ATTEMPTABLE_TYPES: ActivityType[] = [ActivityType.CONTENT_EXERCISE, ActivityType.VOCABULARY_TEST, ActivityType.PRONUNCIATION];

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
      exercise: { id: exercise.id, type: exercise.type, title: exercise.title, config: exercise.config },
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
  async listAssignmentsForStudent(studentId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { studentId },
      include: { exercise: true },
      orderBy: { createdAt: 'desc' },
    });
    const results = await Promise.all(
      assignments.map(async (a) => {
        const latestAttempt = await this.prisma.attempt.findFirst({
          where: { studentId, exerciseId: a.exerciseId, assignmentId: a.id },
          orderBy: { startedAt: 'desc' },
          include: { scoreOverride: true },
        });
        return { assignment: a, exercise: a.exercise, latestAttempt };
      }),
    );
    return results;
  }

  // ---- Serving (start) ----------------------------------------------------

  private async prepareServe(
    exerciseId: string,
    type: ActivityType,
    config: unknown,
  ): Promise<{ maxScore: number; itemOrder: string[]; items?: ServedItem[] }> {
    if (type === ActivityType.PRONUNCIATION) return { maxScore: 5, itemOrder: [] };
    if (type === ActivityType.CONTENT_EXERCISE) return { maxScore: 100, itemOrder: [] };

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
        items: sampled.map((i) => ({ id: i.id, prompt: i.prompt, choices: i.choices, mediaAssetId: i.mediaAssetId ?? undefined })),
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
      const r = response as { selfAssessedScore?: number };
      // Awaits a teacher's assessment (via the gradebook's ScoreOverride —
      // "oldScore: null" legitimately means "first score", not "editing a
      // machine score") rather than auto-scoring off a self-rating.
      return { rawScore: r.selfAssessedScore ?? null, status: AttemptStatus.SUBMITTED };
    }

    // VOCABULARY_TEST
    return this.scoreVocabularyTest(attempt, exercise.config as VocabularyTestConfig, itemResponses);
  }

  private async scoreVocabularyTest(
    attempt: { id: string; itemOrder: string[] },
    config: VocabularyTestConfig,
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
    const skill = type === ActivityType.VOCABULARY_TEST ? 'vocabulary' : type === ActivityType.PRONUNCIATION ? 'pronunciation' : 'reading';
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

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
