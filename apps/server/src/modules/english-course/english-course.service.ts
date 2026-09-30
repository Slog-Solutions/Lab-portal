import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  RecordingStatus,
  type CourseActivitySummary,
  type CourseActivityView,
  type CourseCatalogView,
  type CourseItem,
  type CourseItemResult,
  type CourseProgressView,
  type CourseResultView,
  type CourseReviewArea,
  type StartCourseActivityDto,
  type StartedCourseActivity,
  type SubmitCourseActivityDto,
} from '@lab/shared';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { CATALOG, CATALOG_INDEX, CATALOG_TAGS, validateCatalog, type CatalogEntry } from './catalog';
import { gradeActivity, pickFollowUp, shuffled } from './grading';

/** An unfinished attempt younger than this is resumed (same questions)
 * rather than a fresh one started — reopening an activity mid-way must not
 * reshuffle the test bank under the student. */
const RESUME_WINDOW_MS = 12 * 3600 * 1000;

/** What a submitted attempt keeps in Attempt.served — the grading outcome,
 * so results/progress never re-grade against since-edited content. */
interface StoredOutcome {
  durationMs: number;
  wpm?: number;
  graded: boolean;
  correct: number;
  total: number;
  items: CourseItemResult[];
  reviewAreas: CourseReviewArea[];
}

/**
 * Annexure-I Ser 10 English Course. The content is the in-repo catalog
 * (./catalog); each catalog activity is mirrored by one ENGLISH_COURSE
 * Exercise row (Exercise.catalogKey) so it can be assigned as part of a
 * teacher's course, and every submission is a normal Attempt (+ a
 * SkillProgress row) — which is what gives Ser 10's "Result Tracking":
 * the gradebook and reports see these attempts like any other.
 */
@Injectable()
export class EnglishCourseService implements OnModuleInit {
  private readonly logger = new Logger(EnglishCourseService.name);
  /** catalogKey → Exercise.id, filled by syncCatalog. */
  private readonly exerciseIds = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const problems = validateCatalog();
    if (problems.length > 0) {
      throw new Error(`English Course catalog is invalid:\n${problems.join('\n')}`);
    }
    await this.syncCatalog();
  }

  /** Idempotent: creates the Exercise row for any new catalog activity and
   * keeps titles current. Rows for activities since removed from the
   * catalog are left alone — attempts and assignments still point at them. */
  async syncCatalog(): Promise<void> {
    const rows = await this.prisma.exercise.findMany({
      where: { catalogKey: { not: null } },
      select: { id: true, catalogKey: true, title: true },
    });
    const byKey = new Map(rows.map((r) => [r.catalogKey!, r]));
    let created = 0;
    for (const [key, { activity }] of CATALOG_INDEX) {
      const row = byKey.get(key);
      if (row && row.title === activity.title) {
        this.exerciseIds.set(key, row.id);
        continue;
      }
      const saved = await this.prisma.exercise.upsert({
        where: { catalogKey: key },
        create: { type: ActivityType.ENGLISH_COURSE, title: activity.title, catalogKey: key, config: { catalogKey: key } },
        update: { title: activity.title },
        select: { id: true },
      });
      if (!row) created += 1;
      this.exerciseIds.set(key, saved.id);
    }
    if (created > 0) this.logger.log(`English Course: registered ${created} new catalog activities`);
  }

  // ---- Catalog ------------------------------------------------------------------

  async catalog(studentId: string | null): Promise<CourseCatalogView> {
    const progress = studentId ? await this.progressByKey(studentId) : null;
    return {
      tracks: CATALOG.map((track) => ({
        key: track.key,
        title: track.title,
        description: track.description,
        units: track.units.map((unit) => ({
          key: unit.key,
          title: unit.title,
          ...(unit.description ? { description: unit.description } : {}),
          activities: unit.activities.map(
            (a): CourseActivitySummary => ({
              key: a.key,
              exerciseId: this.exerciseId(a.key),
              title: a.title,
              kind: a.kind,
              cefr: a.cefr,
              skill: a.skill,
              mode: a.mode,
              ...(a.topic ? { topic: a.topic } : {}),
              itemCount: a.sampleSize ?? a.items.length,
              ...(progress ? { progress: progress.get(a.key) ?? { attempts: 0, best: null, last: null, lastAt: null } } : {}),
            }),
          ),
        })),
      })),
    };
  }

  /** Staff preview: the whole activity, answers included, nothing sampled. */
  preview(key: string): CourseActivityView {
    const entry = this.entry(key);
    return this.view(entry, entry.activity.items, true);
  }

  // ---- Attempts -----------------------------------------------------------------

  async start(studentId: string, key: string, dto: StartCourseActivityDto): Promise<StartedCourseActivity> {
    const entry = this.entry(key);
    const exerciseId = this.exerciseId(key);
    const assignmentId = dto.assignmentId ?? null;
    if (assignmentId) {
      const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, select: { studentId: true, exerciseId: true } });
      if (!assignment || assignment.studentId !== studentId || assignment.exerciseId !== exerciseId) {
        throw new ForbiddenException('That assignment is not yours, or is for a different activity');
      }
    }

    const byId = new Map(entry.activity.items.map((i) => [i.id, i]));
    const open = await this.prisma.attempt.findFirst({
      where: {
        studentId,
        exerciseId,
        assignmentId,
        status: AttemptStatus.IN_PROGRESS,
        startedAt: { gte: new Date(Date.now() - RESUME_WINDOW_MS) },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, itemOrder: true },
    });
    if (open && open.itemOrder.every((id) => byId.has(id)) && (open.itemOrder.length > 0 || entry.activity.items.length === 0)) {
      return { attemptId: open.id, activity: this.view(entry, open.itemOrder.map((id) => byId.get(id)!), entry.activity.mode === 'practice') };
    }

    const served = await this.serveItems(entry, studentId);
    const attempt = await this.prisma.attempt.create({
      data: {
        exerciseId,
        studentId,
        assignmentId,
        status: AttemptStatus.IN_PROGRESS,
        itemOrder: served.map((i) => i.id),
        maxScore: 100,
      },
      select: { id: true },
    });
    return { attemptId: attempt.id, activity: this.view(entry, served, entry.activity.mode === 'practice') };
  }

  async submit(studentId: string, attemptId: string, dto: SubmitCourseActivityDto): Promise<CourseResultView> {
    const attempt = await this.loadAttempt(attemptId);
    if (attempt.studentId !== studentId) throw new ForbiddenException('Not your attempt');
    if (attempt.status !== AttemptStatus.IN_PROGRESS) throw new ConflictException('This activity was already submitted');
    const entry = this.entry(attempt.exercise.catalogKey!);
    const served = this.servedItems(entry, attempt.itemOrder);

    // A record item counts only if its Recording really finished uploading
    // for THIS attempt — an id in `answers` on its own proves nothing.
    const claimed = served.filter((i) => i.kind === 'record' && dto.answers[i.id]).map((i) => dto.answers[i.id]!);
    const ready = claimed.length
      ? await this.prisma.recording.findMany({
          where: { id: { in: claimed }, attemptId, status: RecordingStatus.READY },
          select: { id: true },
        })
      : [];
    const readyIds = new Set(ready.map((r) => r.id));
    const recorded = new Set(served.filter((i) => i.kind === 'record' && readyIds.has(dto.answers[i.id] ?? '')).map((i) => i.id));

    const graded = gradeActivity(served, dto.answers, recorded, CATALOG_TAGS);
    const now = new Date();
    const elapsed = now.getTime() - attempt.startedAt.getTime();
    const durationMs = Math.max(0, Math.min(dto.durationMs, elapsed));
    const passage = entry.activity.passage;
    const wpm =
      passage && dto.readingMs && dto.readingMs <= elapsed ? Math.round(passage.wordCount / (dto.readingMs / 60_000)) : undefined;

    const outcome: StoredOutcome = {
      durationMs,
      ...(wpm !== undefined ? { wpm } : {}),
      graded: graded.graded,
      correct: graded.correct,
      total: graded.total,
      items: graded.items,
      reviewAreas: graded.reviewAreas,
    };
    // Conditional on still being IN_PROGRESS, so a double-click can't score twice.
    const updated = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        status: AttemptStatus.SCORED,
        rawScore: graded.score,
        maxScore: 100,
        submittedAt: now,
        answers: dto.answers as Prisma.InputJsonValue,
        served: outcome as unknown as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 0) throw new ConflictException('This activity was already submitted');
    if (graded.graded) {
      await this.prisma.skillProgress.create({ data: { studentId, skill: entry.activity.skill, score: graded.score } });
    }
    return this.result(attemptId, { studentId });
  }

  /** A student may read only their own; staff (studentId omitted) any. */
  async result(attemptId: string, who: { studentId?: string }): Promise<CourseResultView> {
    const attempt = await this.loadAttempt(attemptId);
    if (who.studentId && attempt.studentId !== who.studentId) throw new ForbiddenException('Not your attempt');
    if (attempt.status !== AttemptStatus.SCORED) throw new BadRequestException('This activity has not been submitted yet');
    const entry = this.entry(attempt.exercise.catalogKey!);
    const outcome = attempt.served as unknown as StoredOutcome;
    const history = await this.prisma.attempt.findMany({
      where: { studentId: attempt.studentId, exerciseId: attempt.exerciseId, status: AttemptStatus.SCORED },
      select: { rawScore: true },
    });
    const scores = history.map((h) => h.rawScore).filter((s): s is number => s !== null);
    return {
      attemptId: attempt.id,
      activityKey: entry.activity.key,
      score: attempt.rawScore ?? 0,
      correct: outcome.correct,
      total: outcome.total,
      items: outcome.items,
      reviewAreas: outcome.reviewAreas,
      metrics: { durationMs: outcome.durationMs, ...(outcome.wpm !== undefined ? { wpm: outcome.wpm } : {}) },
      best: scores.length ? Math.max(...scores) : null,
      attempts: scores.length,
      activity: this.view(entry, this.servedItems(entry, attempt.itemOrder), true),
    };
  }

  // ---- Progress (Ser 10 "Result Tracking" / "personal progress page") ------------

  async progress(studentId: string): Promise<CourseProgressView> {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId, status: AttemptStatus.SCORED, exercise: { type: ActivityType.ENGLISH_COURSE } },
      select: { id: true, rawScore: true, submittedAt: true, served: true, exercise: { select: { catalogKey: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    const rows = attempts
      .map((a) => ({ ...a, key: a.exercise.catalogKey ?? '', outcome: a.served as unknown as StoredOutcome | null }))
      .filter((a) => CATALOG_INDEX.has(a.key));

    const graded = rows.filter((r) => r.outcome?.graded && r.rawScore !== null);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    const doneKeys = new Set(rows.map((r) => r.key));

    const byTrack = CATALOG.map((track) => {
      const keys = new Set(track.units.flatMap((u) => u.activities.map((a) => a.key)));
      return {
        track: track.key,
        title: track.title,
        done: [...doneKeys].filter((k) => keys.has(k)).length,
        total: keys.size,
        average: avg(graded.filter((r) => keys.has(r.key)).map((r) => r.rawScore!)),
      };
    });

    const skills = new Map<string, Array<{ at: string; score: number }>>();
    for (const r of graded) {
      const skill = CATALOG_INDEX.get(r.key)!.activity.skill;
      const series = skills.get(skill) ?? [];
      series.push({ at: (r.submittedAt ?? new Date()).toISOString(), score: r.rawScore! });
      skills.set(skill, series);
    }

    // Areas to review: for each tag, the learner's LATEST attempt that
    // served it decides — so an area drops off once any later attempt (the
    // tense quiz again, or the follow-up quiz) gets it right.
    const latestByTag = new Map<string, CourseReviewArea>();
    for (const r of rows) {
      const byId = new Map(CATALOG_INDEX.get(r.key)!.activity.items.map((i) => [i.id, i]));
      const counts = new Map<string, { missed: number; total: number }>();
      for (const res of r.outcome?.items ?? []) {
        const item = byId.get(res.itemId);
        const tag = item && 'tag' in item ? item.tag : undefined;
        if (!tag || res.correct === null) continue;
        const c = counts.get(tag) ?? { missed: 0, total: 0 };
        c.total += 1;
        if (!res.correct) c.missed += 1;
        counts.set(tag, c);
      }
      for (const [tag, c] of counts) {
        const def = CATALOG_TAGS[tag];
        latestByTag.set(tag, { tag, label: def?.label ?? tag, missed: c.missed, total: c.total, ...(def?.activityKey ? { activityKey: def.activityKey } : {}) });
      }
    }
    const areas = [...latestByTag.values()].filter((a) => a.missed > 0);

    const recordings = await this.prisma.recording.findMany({
      where: { status: RecordingStatus.READY, attempt: { studentId, exercise: { type: ActivityType.ENGLISH_COURSE } } },
      select: { id: true, createdAt: true, durationMs: true, attempt: { select: { exercise: { select: { catalogKey: true, title: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      totals: {
        attempts: rows.length,
        activitiesDone: doneKeys.size,
        activitiesTotal: CATALOG_INDEX.size,
        minutes: Math.round(rows.reduce((s, r) => s + (r.outcome?.durationMs ?? 0), 0) / 60_000),
        average: avg(graded.map((r) => r.rawScore!)),
      },
      byTrack,
      bySkill: [...skills.entries()].map(([skill, series]) => ({ skill, average: avg(series.map((p) => p.score)), series })),
      recent: [...rows]
        .reverse()
        .slice(0, 30)
        .map((r) => {
          const entry = CATALOG_INDEX.get(r.key)!;
          return {
            attemptId: r.id,
            activityKey: r.key,
            title: entry.activity.title,
            track: entry.track.key,
            score: r.rawScore,
            at: (r.submittedAt ?? new Date()).toISOString(),
            durationMs: r.outcome?.durationMs ?? null,
          };
        }),
      reviewAreas: areas.sort((a, b) => b.missed / b.total - a.missed / a.total || b.missed - a.missed),
      readingSpeed: rows
        .filter((r) => r.outcome?.wpm !== undefined)
        .map((r) => ({ at: (r.submittedAt ?? new Date()).toISOString(), wpm: r.outcome!.wpm!, comprehension: r.rawScore ?? 0 })),
      recordings: recordings.map((rec) => ({
        id: rec.id,
        activityKey: rec.attempt?.exercise.catalogKey ?? '',
        title: rec.attempt?.exercise.title ?? '',
        createdAt: rec.createdAt.toISOString(),
        durationMs: rec.durationMs,
      })),
    };
  }

  /** For a teacher looking at one student (gradebook / class view). */
  async studentProgress(studentId: string): Promise<CourseProgressView & { student: { id: string; fullName: string; serviceNumber: string } }> {
    const student = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true, fullName: true, serviceNumber: true } });
    if (!student) throw new NotFoundException('Student not found');
    return { ...(await this.progress(studentId)), student };
  }

  // ---- Internals ----------------------------------------------------------------

  private async progressByKey(studentId: string): Promise<Map<string, NonNullable<CourseActivitySummary['progress']>>> {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId, status: AttemptStatus.SCORED, exercise: { type: ActivityType.ENGLISH_COURSE } },
      select: { rawScore: true, submittedAt: true, exercise: { select: { catalogKey: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    const out = new Map<string, NonNullable<CourseActivitySummary['progress']>>();
    for (const a of attempts) {
      const key = a.exercise.catalogKey;
      if (!key) continue;
      const prev = out.get(key) ?? { attempts: 0, best: null, last: null, lastAt: null };
      const score = a.rawScore;
      out.set(key, {
        attempts: prev.attempts + 1,
        best: score === null ? prev.best : Math.max(prev.best ?? 0, score),
        last: score,
        lastAt: (a.submittedAt ?? new Date()).toISOString(),
      });
    }
    return out;
  }

  private entry(key: string): CatalogEntry {
    const entry = CATALOG_INDEX.get(key);
    if (!entry) throw new NotFoundException(`No English Course activity "${key}"`);
    return entry;
  }

  private exerciseId(key: string): string {
    const id = this.exerciseIds.get(key);
    if (!id) throw new NotFoundException(`English Course activity "${key}" is not registered yet`);
    return id;
  }

  private async loadAttempt(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { exercise: { select: { type: true, catalogKey: true } } },
    });
    if (!attempt || attempt.exercise.type !== ActivityType.ENGLISH_COURSE || !attempt.exercise.catalogKey) {
      throw new NotFoundException('English Course attempt not found');
    }
    return attempt;
  }

  private async serveItems(entry: CatalogEntry, studentId: string): Promise<CourseItem[]> {
    const { items, sampleSize, shuffle, followUp } = entry.activity;
    if (followUp && sampleSize !== undefined) {
      const { reviewAreas } = await this.progress(studentId);
      return pickFollowUp(items, new Set(reviewAreas.map((a) => a.tag)), sampleSize);
    }
    if (sampleSize !== undefined) return shuffled(items).slice(0, sampleSize);
    return shuffle ? shuffled(items) : items;
  }

  private servedItems(entry: CatalogEntry, itemOrder: string[]): CourseItem[] {
    const byId = new Map(entry.activity.items.map((i) => [i.id, i]));
    return itemOrder.map((id) => byId.get(id)).filter((i): i is CourseItem => i !== undefined);
  }

  /** The seat's view. A test-mode activity loses every answer key (and the
   * explanations that would give one away) until its result is read. */
  private view(entry: CatalogEntry, items: CourseItem[], withAnswers: boolean): CourseActivityView {
    const { sampleSize: _sample, shuffle: _shuffle, items: _all, ...rest } = entry.activity;
    return {
      ...rest,
      exerciseId: this.exerciseId(entry.activity.key),
      track: entry.track.key,
      unitKey: entry.unit.key,
      items: withAnswers ? items : items.map(stripAnswer),
    };
  }
}

function stripAnswer(item: CourseItem): CourseItem {
  switch (item.kind) {
    case 'choice':
    case 'stress': {
      const { answer: _a, explain: _e, ...rest } = item;
      return rest as CourseItem;
    }
    case 'multi':
    case 'gap': {
      const { answers: _a, explain: _e, ...rest } = item;
      return rest as CourseItem;
    }
    case 'field': {
      const { answers: _a, ...rest } = item;
      return rest;
    }
    case 'write': {
      const { model: _m, ...rest } = item;
      return rest;
    }
    case 'record':
      return item;
  }
}
