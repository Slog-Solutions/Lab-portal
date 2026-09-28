import type { DictionaryPos } from '@lab/shared';

/**
 * Rule-based English inflection generator (spec §4.2 step 5 — "running"
 * -> "run", "mice" -> "mouse"). Irregular forms come straight from OEWN's
 * own `<Form>` elements (see parse-lmf.ts); this file supplies the
 * REGULAR forms nothing in the source data spells out (a released
 * dictionary generally lists "run" but not "runs"/"running").
 *
 * English morphology genuinely depends on syllable stress ("target" ->
 * "targeting", not "targetting"; "admit" -> "admitting"), which a
 * spelling-only rule set can't derive without a pronouncing dictionary.
 * This is intentionally best-effort: it is right for the overwhelming
 * majority of short, common words (which is what a learner looks up),
 * wrong for a modest tail of longer or stress-irregular ones, and its one
 * failure mode is a MISSING reverse-lookup form (a false positive `form`
 * row pointing at the wrong entry is far worse and does not happen here —
 * see NO_DOUBLE_EXCEPTIONS). Multi-word headwords are not inflected at
 * all (spec §4.2 step 5).
 */

const NO_DOUBLE_EXCEPTIONS = new Set([
  'open', 'happen', 'listen', 'visit', 'enter', 'offer', 'suffer', 'differ',
  'gather', 'cover', 'answer', 'travel', 'label', 'panel', 'signal', 'wonder',
  'honor', 'favor', 'develop', 'benefit', 'target', 'focus', 'edit', 'limit',
  'profit', 'orbit', 'exhibit', 'inhabit', 'credit',
]);

const MULTI_SYLLABLE_ADJ_SUFFIXES = ['ful', 'ous', 'ive', 'al', 'ing', 'ed', 'less', 'able', 'ible', 'ish', 'like'];

function endsInConsonantY(word: string): boolean {
  return /[^aeiou]y$/i.test(word);
}

/** run/hop/stop/plan/grab — a single closed final syllable (consonant +
 * short vowel + single final consonant) not ending in w/x/y, minus a
 * short stoplist of common words that are stressed elsewhere and don't
 * actually double (open -> opening, not openning). */
function doublesFinalConsonant(word: string): boolean {
  if (NO_DOUBLE_EXCEPTIONS.has(word)) return false;
  if (!/^[a-z]+$/.test(word)) return false;
  if (word.length > 6) return false; // proxy for "probably not one stressed syllable"
  return /[^aeiou][aeiou][bcdfghjklmnpqrstvz]$/.test(word);
}

function dropsSilentE(word: string): boolean {
  if (!word.endsWith('e')) return false;
  if (word.endsWith('ee') || word.endsWith('oe') || word.endsWith('ye')) return false;
  return true;
}

/** cats/boxes/foxes/churches/dishes/parties — same suffix rule for a
 * noun plural and a verb's 3rd-person singular (spec §4.2 step 5). */
export function regularSAffix(word: string): string {
  if (/[sxz]$/i.test(word) || /(ch|sh)$/i.test(word)) return `${word}es`;
  if (endsInConsonantY(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export interface RegularVerbForms {
  thirdPerson: string;
  gerund: string;
  past: string;
}

export function regularVerbForms(word: string): RegularVerbForms {
  const thirdPerson = regularSAffix(word);

  let gerund: string;
  if (doublesFinalConsonant(word)) {
    gerund = `${word}${word.slice(-1)}ing`;
  } else if (dropsSilentE(word)) {
    gerund = `${word.slice(0, -1)}ing`;
  } else {
    gerund = `${word}ing`;
  }

  let past: string;
  if (doublesFinalConsonant(word)) {
    past = `${word}${word.slice(-1)}ed`;
  } else if (word.endsWith('e')) {
    past = `${word}d`;
  } else if (endsInConsonantY(word)) {
    past = `${word.slice(0, -1)}ied`;
  } else {
    past = `${word}ed`;
  }

  return { thirdPerson, gerund, past };
}

export interface RegularAdjectiveForms {
  comparative: string;
  superlative: string;
}

/** big/bigger/biggest, happy/happier/happiest, nice/nicer/nicest — only
 * for short adjectives; longer ones almost always take more/most instead
 * (beautiful -> "more beautiful", never "beautifuler"), so this
 * deliberately returns null rather than guess for them. */
export function regularAdjectiveForms(word: string): RegularAdjectiveForms | null {
  if (word.length > 6) return null;
  if (MULTI_SYLLABLE_ADJ_SUFFIXES.some((suffix) => word.endsWith(suffix))) return null;

  if (endsInConsonantY(word)) {
    const stem = word.slice(0, -1);
    return { comparative: `${stem}ier`, superlative: `${stem}iest` };
  }
  if (doublesFinalConsonant(word)) {
    const doubled = `${word}${word.slice(-1)}`;
    return { comparative: `${doubled}er`, superlative: `${doubled}est` };
  }
  if (word.endsWith('e')) {
    return { comparative: `${word}r`, superlative: `${word}st` };
  }
  return { comparative: `${word}er`, superlative: `${word}est` };
}

/** All regular forms for one headword under one POS — the set inflect.ts
 * contributes on top of whatever irregular forms the source data named.
 * Multi-word headwords ("round table") are skipped entirely. */
export function generateRegularForms(headword: string, pos: DictionaryPos): string[] {
  const word = headword.toLowerCase();
  if (/\s/.test(word) || !/^[a-z'-]+$/.test(word)) return [];

  switch (pos) {
    case 'noun':
      return [regularSAffix(word)];
    case 'verb': {
      const { thirdPerson, gerund, past } = regularVerbForms(word);
      return [thirdPerson, gerund, past];
    }
    case 'adj': {
      const forms = regularAdjectiveForms(word);
      return forms ? [forms.comparative, forms.superlative] : [];
    }
    case 'adv':
      return [];
  }
}

/** Merges the source's own irregular forms with rule-generated regular
 * ones into the final, deduplicated `form` rows for one entry — lowercase,
 * excluding the headword itself (a form table row identical to the
 * headword_lc would be a redundant, never-taken lookup branch).
 *
 * A verb the source already gives an irregular form for (run -> ran) is
 * special-cased: 3rd-person and gerund are still added (almost always
 * correct even for an irregular verb), but the regex-guessed regular PAST
 * TENSE is skipped — generating "runned" to sit next to the real "ran"
 * would be a wrong invented form, not just a missing one, which is the
 * one failure mode this file's doc comment says to avoid. */
export function buildFormsForEntry(headword: string, pos: DictionaryPos, irregularForms: string[]): string[] {
  const headwordLc = headword.toLowerCase();
  const all = new Set<string>();
  for (const f of irregularForms) {
    const lc = f.toLowerCase();
    if (lc && lc !== headwordLc) all.add(lc);
  }

  const word = headwordLc;
  const isSingleWord = /^[a-z'-]+$/.test(word);
  if (pos === 'verb' && irregularForms.length > 0) {
    if (isSingleWord) {
      all.add(regularSAffix(word));
      all.add(regularVerbForms(word).gerund);
    }
  } else {
    for (const f of generateRegularForms(headword, pos)) {
      if (f) all.add(f);
    }
  }

  all.delete(headwordLc);
  return Array.from(all);
}
