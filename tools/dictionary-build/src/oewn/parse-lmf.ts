import { XMLParser } from 'fast-xml-parser';
import type { DictionaryPos } from '@lab/shared';
import type { ParseResult, ParsedEntry, ParsedSense, ParseStats } from '../types.js';

/**
 * Parses a WN-LMF (Wordnet Lexical Markup Framework) XML document — the
 * format Open English WordNet ships its releases in (spec §4.1). Follows
 * the Global WordNet Association's WN-LMF DTD (github.com/globalwordnet/
 * schemas): a `<Lexicon>` of `<LexicalEntry>` (headword + senses) and
 * `<Synset>` (the shared definition/example/membership a sense points at).
 *
 * VERIFY-BEFORE-SHIP: written against the published DTD, not against a
 * real downloaded OEWN release — this project has no internet access to
 * fetch the multi-hundred-MB release from. Re-run this parser's own test
 * suite against a slice of the real, downloaded XML before the first real
 * build (see fetch-inputs.ts), and check parseStats against the actual
 * document — an unexpected skippedPosCount or a near-zero synsetCount
 * means an attribute/element name in this parser doesn't match the real
 * release and needs adjusting, not that the release is bad.
 */

const POS_MAP: Record<string, DictionaryPos> = {
  n: 'noun',
  v: 'verb',
  a: 'adj',
  s: 'adj', // satellite adjective — same surface category as 'a' for a learner
  r: 'adv',
};

// Heuristic only (see file doc comment) — WN-LMF has no universal
// machine-readable "this sense is archaic" flag; OEWN/Princeton WordNet
// definitions that ARE marked usually say so in the definition text
// itself. Re-tune against real data during the Phase 1 build (spec §4.2
// step 2's quality bar is "drop senses tagged obsolete, archaic or rare",
// not "drop every sense whose definition merely mentions the word").
const ARCHAIC_MARKERS = /\((?:archaic|obsolete|dated|rare|historical)\)/i;

interface RawLexicalEntry {
  '@_id': string;
  Lemma?: { '@_writtenForm'?: string; '@_partOfSpeech'?: string };
  Form?: Array<{ '@_writtenForm'?: string }>;
  Pronunciation?: Array<{ '@_variety'?: string; '#text'?: string } | string>;
  Sense?: Array<{ '@_id'?: string; '@_synset'?: string; '@_n'?: string }>;
}

interface RawSynset {
  '@_id': string;
  '@_partOfSpeech'?: string;
  '@_members'?: string;
  Definition?: Array<{ '#text'?: string } | string>;
  Example?: Array<{ '#text'?: string } | string>;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: { '#text'?: string } | string | undefined): string {
  if (node === undefined) return '';
  return typeof node === 'string' ? node : (node['#text'] ?? '');
}

/** GB/RP preferred over GA/US (spec §4.2 step 4), then anything else, so an
 * OEWN release that DOES carry pronunciations still picks deterministically. */
function pickPronunciation(entries: RawLexicalEntry['Pronunciation']): string | null {
  const list = toArray(entries);
  if (list.length === 0) return null;
  const withVariety = (variety: RegExp) =>
    list.find((p) => typeof p !== 'string' && variety.test(p['@_variety'] ?? ''));
  const gb = withVariety(/^(gb|rp)$/i);
  const ga = withVariety(/^(ga|us)$/i);
  const chosen = gb ?? ga ?? list[0];
  const text = textOf(chosen).trim();
  return text ? text : null;
}

export function parseWnLmf(xml: string): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    isArray: (name) => ['LexicalEntry', 'Synset', 'Form', 'Pronunciation', 'Sense', 'Definition', 'Example'].includes(name),
  });
  const doc = parser.parse(xml) as { LexicalResource?: { Lexicon?: Record<string, unknown> } };
  const lexicon = doc.LexicalResource?.Lexicon;
  if (!lexicon) throw new Error('WN-LMF document has no <LexicalResource><Lexicon>');

  const lexicalEntries = toArray(lexicon.LexicalEntry as RawLexicalEntry[] | undefined);
  const synsetsRaw = toArray(lexicon.Synset as RawSynset[] | undefined);

  // entryId -> headword, needed to resolve a synset's `members` (entry ids)
  // into the actual synonym words a sense should show.
  const headwordByEntryId = new Map<string, string>();
  for (const e of lexicalEntries) {
    const headword = e.Lemma?.['@_writtenForm'];
    if (headword) headwordByEntryId.set(e['@_id'], headword);
  }

  interface SynsetInfo {
    definition: string;
    examples: string[];
    memberEntryIds: string[];
  }
  const synsetById = new Map<string, SynsetInfo>();
  for (const s of synsetsRaw) {
    const definition = textOf(toArray(s.Definition)[0]).trim();
    const examples = toArray(s.Example)
      .map((ex) => textOf(ex).trim())
      .filter(Boolean);
    const memberEntryIds = (s['@_members'] ?? '').split(/\s+/).filter(Boolean);
    synsetById.set(s['@_id'], { definition, examples, memberEntryIds });
  }

  // Fallback for an LMF release that omits Synset/@members: derive synset
  // membership from which entries have a Sense pointing at it.
  const membersBySynsetFallback = new Map<string, Set<string>>();
  for (const e of lexicalEntries) {
    for (const sense of toArray(e.Sense)) {
      const synsetId = sense['@_synset'];
      if (!synsetId) continue;
      if (!membersBySynsetFallback.has(synsetId)) membersBySynsetFallback.set(synsetId, new Set());
      membersBySynsetFallback.get(synsetId)!.add(e['@_id']);
    }
  }

  const stats: ParseStats = { lexicalEntryCount: lexicalEntries.length, synsetCount: synsetsRaw.length, skippedPosCount: 0 };
  const entries: ParsedEntry[] = [];

  for (const e of lexicalEntries) {
    const headword = e.Lemma?.['@_writtenForm'];
    const rawPos = e.Lemma?.['@_partOfSpeech'];
    if (!headword || !rawPos) continue;
    const pos = POS_MAP[rawPos.toLowerCase()];
    if (!pos) {
      stats.skippedPosCount++;
      continue;
    }

    const irregularForms = toArray(e.Form)
      .map((f) => f['@_writtenForm'])
      .filter((f): f is string => !!f && f.toLowerCase() !== headword.toLowerCase());

    const ipa = pickPronunciation(e.Pronunciation);

    const senseList = toArray(e.Sense);
    const senses: ParsedSense[] = [];
    senseList.forEach((sense, index) => {
      const synsetId = sense['@_synset'];
      if (!synsetId) return;
      const synset = synsetById.get(synsetId);
      if (!synset || !synset.definition) return;

      const memberIds = synset.memberEntryIds.length > 0
        ? synset.memberEntryIds
        : Array.from(membersBySynsetFallback.get(synsetId) ?? []);
      const synonyms = memberIds
        .filter((id) => id !== e['@_id'])
        .map((id) => headwordByEntryId.get(id))
        .filter((w): w is string => !!w && w.toLowerCase() !== headword.toLowerCase());

      const ordRaw = sense['@_n'];
      const ord = ordRaw !== undefined && ordRaw !== '' ? Number(ordRaw) : index;

      senses.push({
        ord: Number.isFinite(ord) ? ord : index,
        definition: synset.definition,
        examples: synset.examples,
        synonyms: Array.from(new Set(synonyms)),
        archaicOrRare: ARCHAIC_MARKERS.test(synset.definition),
        source: 'oewn',
      });
    });

    if (senses.length === 0) continue;
    senses.sort((a, b) => a.ord - b.ord);

    entries.push({ headword, pos, ipa, irregularForms: Array.from(new Set(irregularForms)), senses });
  }

  return { entries, stats };
}
