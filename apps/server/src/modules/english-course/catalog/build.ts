import type { CourseItem, CourseSpeech, CourseVoice } from '@lab/shared';
import type { CatalogActivity } from './types';

/**
 * Authoring helpers, so hundreds of items stay one readable line each.
 * Item ids are assigned by position (`i1`, `i2`, ...) inside an activity —
 * append new items at the end so existing attempts' served ids keep
 * pointing at the same content.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ItemDraft = DistributiveOmit<CourseItem, 'id'>;

export function say(text: string, voice: CourseVoice = 'en_GB', speaker?: string): CourseSpeech[] {
  return [{ text, voice, ...(speaker ? { speaker } : {}) }];
}

export function activity(def: Omit<CatalogActivity, 'items'> & { items?: ItemDraft[] }): CatalogActivity {
  const items = (def.items ?? []).map((item, i) => ({ ...item, id: `i${i + 1}` }) as CourseItem);
  return { ...def, items };
}

/** Item ids of `items` from `from` (1-based, inclusive) to `to` — for a
 * tutorial step's checkItemIds. */
export function ids(from: number, to: number = from): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `i${from + i}`);
}

/** `pho-*to-gra-pher` → units pho/to/gra/pher, stress on "to". Exactly one
 * unit carries the `*`. The audio is the word itself (or `spoken`). */
export function stressWord(notation: string, opts: { prompt?: string; spoken?: string; tag?: string; explain?: string } = {}): ItemDraft {
  const parts = notation.split('-');
  const answer = parts.findIndex((p) => p.startsWith('*'));
  if (answer < 0 || parts.filter((p) => p.startsWith('*')).length !== 1) {
    throw new Error(`stressWord needs exactly one * in "${notation}"`);
  }
  const units = parts.map((p) => p.replace('*', ''));
  const word = units.join('');
  return {
    kind: 'stress',
    prompt: opts.prompt ?? 'Listen, then tap the stressed syllable.',
    units,
    answer,
    audio: say(opts.spoken ?? word),
    ...(opts.tag ? { tag: opts.tag } : {}),
    explain: opts.explain ?? units.map((u, i) => (i === answer ? u.toUpperCase() : u)).join('-'),
  };
}

/** `a *green house` → words, stress on "green". */
export function stressPhrase(notation: string, opts: { prompt?: string; spoken?: string; tag?: string; explain?: string } = {}): ItemDraft {
  const words = notation.split(' ');
  const answer = words.findIndex((w) => w.startsWith('*'));
  if (answer < 0 || words.filter((w) => w.startsWith('*')).length !== 1) {
    throw new Error(`stressPhrase needs exactly one * in "${notation}"`);
  }
  const units = words.map((w) => w.replace('*', ''));
  return {
    kind: 'stress',
    prompt: opts.prompt ?? 'Listen, then tap the word with the main stress.',
    units,
    answer,
    audio: say(opts.spoken ?? units.join(' ')),
    ...(opts.tag ? { tag: opts.tag } : {}),
    ...(opts.explain ? { explain: opts.explain } : {}),
  };
}

/** `I'd like [a] cup [of] tea.` → one gap item per bracket (the other
 * brackets shown filled in); the audio is always the whole sentence. */
export function gapsFrom(
  sentence: string,
  opts: { prompt?: string; tag?: string; explain?: string; accept?: Record<string, string[]>; voice?: CourseVoice } = {},
): ItemDraft[] {
  const spoken = sentence.replace(/\[([^\]]+)\]/g, '$1');
  const gaps = [...sentence.matchAll(/\[([^\]]+)\]/g)];
  if (gaps.length === 0) throw new Error(`gapsFrom needs a [bracket] in "${sentence}"`);
  return gaps.map((gap, n) => {
    let seen = -1;
    const text = sentence.replace(/\[([^\]]+)\]/g, (_m, word: string) => {
      seen += 1;
      return seen === n ? '___' : word;
    });
    const word = gap[1]!;
    return {
      kind: 'gap' as const,
      prompt: opts.prompt ?? 'Listen and type the missing word.',
      text,
      audio: say(spoken, opts.voice),
      answers: [word, ...(opts.accept?.[word] ?? [])],
      ...(opts.tag ? { tag: opts.tag } : {}),
      ...(opts.explain ? { explain: opts.explain } : {}),
    };
  });
}

export function choice(
  prompt: string,
  answer: string,
  distractors: string[],
  opts: { audio?: CourseSpeech[]; tag?: string; explain?: string; phase?: 'gist' | 'detail'; keepOrder?: boolean } = {},
): ItemDraft {
  const choices = opts.keepOrder ? [answer, ...distractors] : interleave(answer, distractors, prompt + answer);
  return {
    kind: 'choice',
    prompt,
    choices,
    answer,
    ...(opts.audio ? { audio: opts.audio } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}),
    ...(opts.explain ? { explain: opts.explain } : {}),
    ...(opts.phase ? { phase: opts.phase } : {}),
  };
}

/** Deterministic answer placement (a hash of the prompt), so the right
 * answer isn't always first without making the catalog random per boot. */
function interleave(answer: string, distractors: string[], seed: string): string[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const at = h % (distractors.length + 1);
  const out = [...distractors];
  out.splice(at, 0, answer);
  return out;
}

/** `sh[ee]p` → "sheep" (for speech). */
export function plain(example: string): string {
  return example.replace(/[[\]]/g, '');
}
