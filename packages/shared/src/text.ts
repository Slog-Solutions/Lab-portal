/** Stored as the score-override reason when a teacher marks a writing test
 * without a note (the override requires a non-empty reason). The console
 * treats it as "no feedback" rather than displaying it. */
export const NO_WRITTEN_FEEDBACK = 'No written feedback.';

/** Whitespace-separated word count. Shared so a writing test's live counter
 * on the student console and the server's min/max check always agree. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
