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
