import { MULTI_ANSWER_SEPARATOR, type CourseItem } from './types/english-course.js';

/**
 * Item-level grading for the English Course, shared so a seat's instant
 * "test-as-you-learn" feedback and the server's authoritative grade can
 * never disagree about what counts as right.
 */

/** Case, punctuation, curly-quote and whitespace insensitive. Apostrophes
 * survive (so "its" and "it's" stay different answers), hyphens become
 * spaces ("well-known" = "well known"). */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words containing a letter or digit (so a stray "---" is not a word). */
function wordsIn(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The phrases of `mustUse` found in `text` (whole words, case-insensitive). */
export function usedPhrases(text: string, mustUse: readonly string[]): string[] {
  const hay = ` ${normalizeAnswer(text)} `;
  return mustUse.filter((phrase) => hay.includes(` ${normalizeAnswer(phrase)} `));
}

/** What a `write` item asks for, and whether `text` delivers it. */
export function writeRequirements(
  item: Extract<CourseItem, { kind: 'write' }>,
  text: string,
): { words: number; wordsOk: boolean; used: string[]; needed: number; usedOk: boolean; met: boolean } {
  const words = wordsIn(text);
  const used = usedPhrases(text, item.mustUse ?? []);
  const needed = item.mustUse?.length ? Math.min(item.mustUseMin ?? item.mustUse.length, item.mustUse.length) : 0;
  const wordsOk = words >= item.minWords;
  const usedOk = used.length >= needed;
  return { words, wordsOk, used, needed, usedOk, met: wordsOk && usedOk };
}

export function splitMulti(value: string): string[] {
  return value
    .split(MULTI_ANSWER_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True/false for a gradable item, null for a record item (completion
 * only) — and null too when the item carries no answer key (a test-mode
 * view on a seat), so a caller can't mistake "unknown" for "wrong". */
export function gradeItem(item: CourseItem, given: string | undefined): boolean | null {
  if (item.kind === 'record') return null;
  if (item.kind === 'write') return given === undefined || given.trim() === '' ? false : writeRequirements(item, given).met;
  const hasKey = item.kind === 'choice' || item.kind === 'stress' ? item.answer !== undefined : item.answers !== undefined;
  if (!hasKey) return null;
  if (given === undefined || given.trim() === '') return false;
  switch (item.kind) {
    case 'choice':
      return normalizeAnswer(given) === normalizeAnswer(item.answer ?? '');
    case 'multi': {
      const want = new Set((item.answers ?? []).map(normalizeAnswer));
      const got = new Set(splitMulti(given).map(normalizeAnswer));
      return want.size === got.size && [...want].every((a) => got.has(a));
    }
    case 'gap':
    case 'field':
      return (item.answers ?? []).some((a) => normalizeAnswer(a) === normalizeAnswer(given));
    case 'stress':
      return Number(given) === item.answer;
  }
}

/** Display form of an item's right answer. */
export function expectedAnswer(item: CourseItem): string | null {
  switch (item.kind) {
    case 'choice':
      return item.answer ?? null;
    case 'multi':
      return (item.answers ?? []).join(', ');
    case 'gap':
    case 'field':
      return item.answers?.[0] ?? null;
    case 'stress':
      return item.answer === undefined ? null : (item.units[item.answer] ?? null);
    case 'write':
      return item.model ?? null;
    case 'record':
      return null;
  }
}
