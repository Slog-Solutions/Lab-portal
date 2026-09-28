import type { DictionaryPos } from '@lab/shared';
import type { ParsedEntry, ParsedSense, RankedEntry } from './types.js';
import { cleanDefinition, cleanExample } from './clean.js';
import { buildFormsForEntry } from './inflect.js';

export interface RankStats {
  headwordPosPairs: number;
  droppedArchaicOrRare: number;
  droppedEmptyAfterCleaning: number;
  cappedBeyondFiveSenses: number;
  droppedEmptyEntries: number;
}

export interface RankResult {
  entries: RankedEntry[];
  stats: RankStats;
}

const MAX_SENSES_PER_HEADWORD_POS = 5;

/**
 * Spec §4.2 steps 2-3: merges same headword+POS across LexicalEntry rows,
 * drops archaic/obsolete/rare senses, caps at 5 senses, cleans text, and
 * assigns `freq_rank`.
 *
 * `freq_rank` proxy: OEWN/Princeton WordNet ship no open frequency list
 * (spec has no source for one), so this ranks by total sense count across
 * every POS for the headword (a genuinely polysemous word like "run" or
 * "set" IS usually a common word — see design doc's own "run, running,
 * ran, runs" and "set" examples), then shorter headword, then
 * alphabetical, for a fully deterministic order (spec §4.4 A12
 * reproducibility). Revisit if suggest/search ordering looks wrong
 * against real usage — an open frequency list would replace this
 * function's sort key, not the rest of the pipeline.
 */
export function rankEntries(parsed: ParsedEntry[]): RankResult {
  interface Group {
    headword: string;
    pos: DictionaryPos;
    ipa: string | null;
    irregularForms: string[];
    senses: ParsedSense[];
  }
  const groups = new Map<string, Group>();
  for (const e of parsed) {
    const key = `${e.headword.toLowerCase()}\u0000${e.pos}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ipa = existing.ipa ?? e.ipa;
      existing.irregularForms.push(...e.irregularForms);
      existing.senses.push(...e.senses);
    } else {
      groups.set(key, { headword: e.headword, pos: e.pos, ipa: e.ipa, irregularForms: [...e.irregularForms], senses: [...e.senses] });
    }
  }

  const totalSensesByHeadwordLc = new Map<string, number>();
  for (const g of groups.values()) {
    const lc = g.headword.toLowerCase();
    totalSensesByHeadwordLc.set(lc, (totalSensesByHeadwordLc.get(lc) ?? 0) + g.senses.length);
  }
  const headwordLcs = Array.from(new Set(Array.from(groups.values(), (g) => g.headword.toLowerCase())));
  headwordLcs.sort((a, b) => {
    const diff = (totalSensesByHeadwordLc.get(b) ?? 0) - (totalSensesByHeadwordLc.get(a) ?? 0);
    if (diff !== 0) return diff;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  const freqRankByHeadwordLc = new Map<string, number>();
  headwordLcs.forEach((lc, i) => freqRankByHeadwordLc.set(lc, i + 1));

  const stats: RankStats = {
    headwordPosPairs: groups.size,
    droppedArchaicOrRare: 0,
    droppedEmptyAfterCleaning: 0,
    cappedBeyondFiveSenses: 0,
    droppedEmptyEntries: 0,
  };
  const entries: RankedEntry[] = [];

  for (const g of groups.values()) {
    const notArchaic = g.senses.filter((s) => !s.archaicOrRare);
    stats.droppedArchaicOrRare += g.senses.length - notArchaic.length;

    const cleaned = notArchaic
      .map((s) => ({ ...s, cleanedDefinition: cleanDefinition(s.definition) }))
      .filter((s) => s.cleanedDefinition.length > 0);
    stats.droppedEmptyAfterCleaning += notArchaic.length - cleaned.length;

    cleaned.sort((a, b) => a.ord - b.ord);
    const capped = cleaned.slice(0, MAX_SENSES_PER_HEADWORD_POS);
    stats.cappedBeyondFiveSenses += cleaned.length - capped.length;

    if (capped.length === 0) {
      stats.droppedEmptyEntries++;
      continue;
    }

    entries.push({
      headword: g.headword,
      headwordLc: g.headword.toLowerCase(),
      pos: g.pos,
      ipa: g.ipa,
      freqRank: freqRankByHeadwordLc.get(g.headword.toLowerCase()) ?? headwordLcs.length + 1,
      senses: capped.map((s, i) => ({
        ord: i + 1,
        definition: s.cleanedDefinition,
        example: s.examples.length > 0 ? cleanExample(s.examples[0]!) : null,
        synonyms: s.synonyms,
        source: s.source,
      })),
      forms: buildFormsForEntry(g.headword, g.pos, g.irregularForms),
    });
  }

  return { entries, stats };
}
