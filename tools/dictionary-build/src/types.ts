import type { DictionaryPos, DictionarySenseSource } from '@lab/shared';

/** Intermediate, pipeline-internal representation — one step removed from
 * both the raw WN-LMF XML and the final SQLite rows, so rank.ts/inflect.ts/
 * clean.ts can each transform it without re-parsing or re-serializing. */

export interface ParsedSense {
  /** Original LMF sense order (the entry's Sense/@n, or array position when
   * absent) — OEWN inherits Princeton WordNet's "most common first"
   * ordering, so this IS the frequency signal (spec §4.2 step 2). */
  ord: number;
  definition: string;
  examples: string[];
  /** Other headwords sharing this sense's synset, self excluded. */
  synonyms: string[];
  /** Tagged archaic/obsolete/rare in the source data — dropped in rank.ts
   * (spec §4.2 step 2), kept here so the drop is a visible, testable step
   * rather than baked into the parser. */
  archaicOrRare: boolean;
  source: DictionarySenseSource;
}

export interface ParsedEntry {
  headword: string;
  pos: DictionaryPos;
  /** IPA from the source's own <Pronunciation>, when present. British
   * ("GB"/"RP") preferred over American ("US"/"GA") per spec §4.2 step 4 —
   * relevant even in OEWN-only mode, since some OEWN releases do carry a
   * handful of Pronunciation elements even though most don't. */
  ipa: string | null;
  /** Irregular inflected forms this entry's own LMF <Form> elements name
   * (ran, mice, ...) — regular forms are generated separately, see
   * inflect.ts. */
  irregularForms: string[];
  senses: ParsedSense[];
}

export interface ParseStats {
  lexicalEntryCount: number;
  synsetCount: number;
  /** LexicalEntries whose partOfSpeech isn't one of noun/verb/adj/adv
   * (e.g. LMF's own 'u' for "other") — counted, not silently merged in. */
  skippedPosCount: number;
}

export interface ParseResult {
  entries: ParsedEntry[];
  stats: ParseStats;
}

/** A fully ranked, capped, cleaned entry — one row of `entry` plus its
 * `sense` rows, ready for write-db.ts. `freqRank` is 1-based, lower = more
 * common (spec §4.3 schema comment); see rank.ts's own doc comment for how
 * it's derived without a real open frequency list. */
export interface RankedEntry {
  headword: string;
  headwordLc: string;
  pos: DictionaryPos;
  ipa: string | null;
  freqRank: number;
  senses: Array<{
    ord: number;
    definition: string;
    example: string | null;
    synonyms: string[];
    source: DictionarySenseSource;
  }>;
  /** Inflected/variant forms (irregular + rule-generated), lowercased,
   * deduplicated, excluding the headword itself. */
  forms: string[];
}
