import type { CefrLevel } from '@lab/shared';
import { choice, type ItemDraft } from '../build';

/** Multiple choice over a sentence with a `___` gap. */
export function mc(sentence: string, answer: string, distractors: string[], explain?: string): ItemDraft {
  return choice(sentence, answer, distractors, { ...(explain ? { explain } : {}) });
}

/** Type the verb form: `text` holds one `___` and the verb hint in brackets,
 * e.g. `She ___ (study) at night school.` Every spelling in `answers` is accepted. */
export function fill(text: string, answers: string[], explain?: string): ItemDraft {
  return { kind: 'gap', prompt: 'Write the correct form of the verb in brackets.', text, answers, ...(explain ? { explain } : {}) };
}

export interface LessonStep {
  title: string;
  body: string[];
  /** [sentence, note] — played aloud in the lesson. */
  examples?: Array<[string, string?]>;
  /** Check questions answered (and marked) before the next step opens. */
  checks: ItemDraft[];
}

export interface Tense {
  key: string;
  title: string;
  cefr: CefrLevel;
  group: 'present' | 'past' | 'future';
  /** One line shown on the lesson and used as the default explanation. */
  hint: string;
  steps: LessonStep[];
  /** The quiz bank: each attempt serves a random sample of it, and the
   * whole bank also feeds the big test bank and the follow-up quiz. */
  bank: ItemDraft[];
}
