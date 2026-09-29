/**
 * Test-only helper for GF-6 ("the answer key must never reach the
 * student's machine before reveal"). Walks an arbitrary JSON-ish payload
 * looking for any of the given secret strings, and reports where it found
 * one — except inside a `choices` array, where an MCQ's correct answer is
 * *expected* to appear (it's one of the options every student sees; the
 * point is that nothing marks it as correct).
 *
 * Not shipped in the server's runtime bundle — imported only from *.spec.ts.
 */
export interface AnswerLeakOptions {
  /** Correct-answer strings that may only appear inside a `choices` array. */
  answers: string[];
  /** Strings that may never appear anywhere in the payload. */
  explanations?: string[];
}

export interface AnswerLeak {
  path: string;
  value: string;
  kind: 'answer' | 'explanation';
}

export function findAnswerLeaks(payload: unknown, opts: AnswerLeakOptions): AnswerLeak[] {
  const answers = new Set(opts.answers.filter((a) => a.length > 0));
  const explanations = new Set((opts.explanations ?? []).filter((e) => e.length > 0));
  const leaks: AnswerLeak[] = [];

  function walk(node: unknown, path: string, insideChoices: boolean): void {
    if (typeof node === 'string') {
      if (explanations.has(node)) leaks.push({ path, value: node, kind: 'explanation' });
      if (answers.has(node) && !insideChoices) leaks.push({ path, value: node, kind: 'answer' });
      return;
    }
    if (Array.isArray(node)) {
      const childIsChoices = path.endsWith('.choices') || path.endsWith('.choices[]');
      node.forEach((child, i) => walk(child, `${path}[${i}]`, childIsChoices));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, path ? `${path}.${key}` : key, false);
      }
    }
  }

  walk(payload, '$', false);
  return leaks;
}
