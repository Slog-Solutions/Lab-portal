import type { VocabQuestionInput } from '../../lib/assessments-api';

/** Most questions one assignment may carry (mirrors AssessmentsService). */
export const MAX_QUESTIONS = 200;

/**
 * Feedback while the teacher types a question list, so a mistake shows up
 * before Create rather than as a server error. The server still parses the
 * text itself (parseWordListText) — this only mirrors its rules closely
 * enough to count lines and spot a bad one:
 *   prompt = answer
 *   prompt = answer | wrong | wrong      (multiple choice; the first is correct)
 * Blank lines and lines starting with # are ignored.
 */
export function analyseQuestionList(text: string): { count: number; badLine: string | null } {
  let count = 0;
  let badLine: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    // `line` is trimmed, so eq > 0 means the prompt has real characters.
    if (eq > 0 && line.slice(eq + 1).trim().length > 0) count += 1;
    else badLine ??= line;
  }
  return { count, badLine };
}

export interface ParsedQuestionList {
  questions: VocabQuestionInput[];
  /** A line that couldn't become a real MCQ question on its own (currently
   * only "no options besides the answer" — a short-answer import line) —
   * the question is still added with one option, so the teacher edits it
   * in the builder instead of losing the line entirely. */
  warnings: string[];
}

/**
 * SPEC-mcq-test-timed-reveal.md §7.1 "Import path: keep the existing
 * word-list import... as a fast way to seed a form, then edit in the
 * builder." Same `prompt = answer | wrong | wrong` syntax as the server's
 * parseWordListText, turned into the builder's own question shape
 * (answer is always the first choice, per that same convention) — the
 * server is still the actual authority at save time (build()'s own
 * validation), this is only for seeding the builder's editable state.
 */
export function parseQuestionList(text: string): ParsedQuestionList {
  const questions: VocabQuestionInput[] = [];
  const warnings: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const prompt = eq > 0 ? line.slice(0, eq).trim() : '';
    const rest = eq > 0 ? line.slice(eq + 1).trim() : '';
    if (!prompt || !rest) {
      warnings.push(line);
      continue;
    }
    const parts = [...new Set(rest.split('|').map((s) => s.trim()).filter(Boolean))].slice(0, 6);
    if (parts.length < 2) {
      questions.push({ prompt, options: parts.length ? parts : [rest], correctIndex: 0 });
      warnings.push(`"${prompt}" needs at least one more option — it only has an answer, no wrong choices`);
      continue;
    }
    questions.push({ prompt, options: parts, correctIndex: 0 });
  }
  return { questions, warnings };
}
