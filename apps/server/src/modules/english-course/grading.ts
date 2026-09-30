import { expectedAnswer, gradeItem, type CourseItem, type CourseItemResult, type CourseReviewArea } from '@lab/shared';
import type { CatalogTag } from './catalog/types';

export { gradeItem, normalizeAnswer } from '@lab/shared';

/**
 * Activity-level grading for the English Course — no Prisma, no Nest, so
 * every rule here is unit-tested directly (grading.spec.ts). Item-level
 * rules live in @lab/shared so the seat's instant feedback matches.
 */

export interface GradedActivity {
  items: CourseItemResult[];
  correct: number;
  /** Gradable items served (record items excluded). */
  total: number;
  /** 0-100. With no gradable item it is the share of record items done. */
  score: number;
  /** False when nothing was gradable — the score is completion, not
   * performance, and must not feed a skill average. */
  graded: boolean;
  reviewAreas: CourseReviewArea[];
}

/**
 * `recorded` holds the record items whose Recording really exists for this
 * attempt — the caller verifies that; a bare id in `answers` proves nothing.
 */
export function gradeActivity(
  served: CourseItem[],
  answers: Record<string, string>,
  recorded: ReadonlySet<string>,
  tags: Record<string, CatalogTag>,
): GradedActivity {
  const results: CourseItemResult[] = [];
  const byTag = new Map<string, { missed: number; total: number }>();
  let correct = 0;
  let total = 0;
  let records = 0;
  let recordsDone = 0;

  for (const item of served) {
    if (item.kind === 'record') {
      records += 1;
      const done = recorded.has(item.id);
      if (done) recordsDone += 1;
      results.push({ itemId: item.id, given: done ? (answers[item.id] ?? null) : null, correct: null, expected: null });
      continue;
    }
    const given = answers[item.id];
    const ok = gradeItem(item, given) === true;
    total += 1;
    if (ok) correct += 1;
    results.push({
      itemId: item.id,
      given: given ?? null,
      correct: ok,
      expected: expectedAnswer(item),
      ...('explain' in item && item.explain ? { explain: item.explain } : {}),
    });
    const tag = item.tag;
    if (tag) {
      const entry = byTag.get(tag) ?? { missed: 0, total: 0 };
      entry.total += 1;
      if (!ok) entry.missed += 1;
      byTag.set(tag, entry);
    }
  }

  const graded = total > 0;
  const score = graded ? Math.round((correct / total) * 1000) / 10 : records > 0 ? Math.round((recordsDone / records) * 1000) / 10 : 100;
  const reviewAreas = [...byTag.entries()]
    .filter(([, v]) => v.missed > 0)
    .map(([tag, v]) => ({ tag, label: tags[tag]?.label ?? tag, missed: v.missed, total: v.total, activityKey: tags[tag]?.activityKey }))
    .sort((a, b) => b.missed / b.total - a.missed / a.total || b.missed - a.missed);

  return { items: results, correct, total, score, graded, reviewAreas };
}

/** Fisher-Yates over a copy; `random` is injectable for tests. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * The follow-up quiz (Ser 10 "Follow up quiz ... highlights the particular
 * areas where the learner mistake"): items from the areas the learner last
 * got wrong come first, shuffled; when those are too few to make a
 * worthwhile quiz it is topped up with other items so it never comes up
 * empty. `weakTags` empty → a plain random sample.
 */
export function pickFollowUp<T extends { kind: string }>(
  items: readonly T[],
  weakTags: ReadonlySet<string>,
  size: number,
  random: () => number = Math.random,
  minWeak = 10,
): T[] {
  const weak = shuffled(
    items.filter((i) => 'tag' in i && typeof i.tag === 'string' && weakTags.has(i.tag)),
    random,
  ).slice(0, size);
  if (weak.length >= Math.min(minWeak, size)) return weak;
  const rest = shuffled(
    items.filter((i) => !weak.includes(i)),
    random,
  );
  return shuffled([...weak, ...rest.slice(0, size - weak.length)], random);
}
