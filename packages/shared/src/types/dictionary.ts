import { ActivityType } from './enums.js';

/**
 * Offline dictionary lookup (SPEC-offline-dictionary.md). One file holds
 * the whole cross-cutting contract — types, the SQLite schema DDL the
 * build pipeline and the server both need to agree on byte-for-byte, the
 * teacher-control default policy, and the pure text helpers the client
 * needs for selection lookup / Ctrl+D — the same "interfaces + free
 * functions in one file" shape as desired-state.ts, since none of this
 * is large enough to earn its own package subpath.
 */

// ---- SQLite schema (spec §4.3) ------------------------------------------------

/** Bump whenever DICTIONARY_SCHEMA_SQL changes shape. DictionaryStoreService
 * refuses to open a `dictionary.db` whose `meta.schema_version` doesn't
 * match this — see spec §5 "must start anyway and report available:false". */
export const DICTIONARY_SCHEMA_VERSION = 1;

export const DICTIONARY_SCHEMA_SQL = `
CREATE TABLE entry (
  id          INTEGER PRIMARY KEY,
  headword    TEXT NOT NULL,
  headword_lc TEXT NOT NULL,
  pos         TEXT NOT NULL,
  ipa         TEXT,
  freq_rank   INTEGER
);
CREATE INDEX idx_entry_lc ON entry(headword_lc);

CREATE TABLE sense (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES entry(id),
  ord         INTEGER NOT NULL,
  definition  TEXT NOT NULL,
  example     TEXT,
  synonyms    TEXT,
  source      TEXT NOT NULL
);
CREATE INDEX idx_sense_entry ON sense(entry_id, ord);

CREATE TABLE form (
  form_lc     TEXT NOT NULL,
  entry_id    INTEGER NOT NULL REFERENCES entry(id),
  PRIMARY KEY (form_lc, entry_id)
);
CREATE INDEX idx_form_entry ON form(entry_id);

CREATE VIRTUAL TABLE entry_fts USING fts5(
  headword, definition, content=''
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`.trim();

/** One row of `meta` per key — see write-db.ts / DictionaryStoreService. */
export const DICTIONARY_META_KEYS = [
  'schema_version',
  'built_at',
  'sources',
  'licence_mode',
  'oewn_version',
  'wiktionary_dump',
  'attribution',
  'licence_text',
] as const;
export type DictionaryMetaKey = (typeof DICTIONARY_META_KEYS)[number];

// ---- API contract (spec §5) ----------------------------------------------

export type DictionaryPos = 'noun' | 'verb' | 'adj' | 'adv';
export type DictionarySenseSource = 'oewn' | 'wiktionary';

export interface DictionarySense {
  definition: string;
  example: string | null;
  synonyms: string[];
  source: DictionarySenseSource;
}

export interface DictionaryEntry {
  pos: DictionaryPos;
  senses: DictionarySense[];
}

export interface DictionaryLookupResult {
  found: boolean;
  /** The word actually looked up, once normalized. */
  query: string;
  headword: string | null;
  ipa: string | null;
  entries: DictionaryEntry[];
  /** Set when `query` resolved through the `form` table (an inflection)
   * rather than as a headword directly — e.g. "running" -> resolvedFrom
   * "running", headword "run". Null on a direct headword hit. */
  resolvedFrom: string | null;
  /** Up to 5 "did you mean" headwords, only populated when found=false. */
  suggestions: string[];
  attribution: string;
}

export interface DictionaryMeta {
  available: boolean;
  /** Why unavailable — missing file, unreadable, unsupported schema
   * version. Absent when available=true. */
  reason?: string;
  schemaVersion?: number;
  builtAt?: string;
  sources?: string[];
  licenceMode?: 'oewn' | 'oewn,wiktionary';
  oewnVersion?: string;
  attribution?: string;
  licenceText?: string;
}

// ---- Teacher-control default policy (spec §7) -----------------------------

/** Activity types where the dictionary defaults OFF — looking up the
 * answer during a vocabulary test defeats the test (spec §7). Everything
 * else defaults on. A teacher can override per instance/exercise. */
export const DICTIONARY_OFF_BY_DEFAULT_ACTIVITIES: ActivityType[] = [ActivityType.VOCABULARY_TEST];

/** The single choke point both SessionStateService (live sessions) and
 * DictionaryPolicyService (assignment-based tests) resolve the flag
 * through, so "what does dictionaryEnabled default to for this activity"
 * has one home. `override` is the persisted column value: null means
 * "use the type's default", true/false is an explicit teacher choice. */
export function resolveDictionaryEnabled(type: ActivityType | null, override: boolean | null | undefined): boolean {
  if (override === true || override === false) return override;
  if (type === null) return true;
  return !DICTIONARY_OFF_BY_DEFAULT_ACTIVITIES.includes(type);
}

// ---- Client text helpers ---------------------------------------------------

/** Normalizes a raw query/selection into what the server's headword_lc
 * columns are keyed on: NFC-normalized, trimmed, lowercased, surrounding
 * punctuation stripped, internal whitespace collapsed to single spaces.
 * Shared so the client's debounced type-ahead and the server's lookup
 * resolution never disagree on what counts as "the same query". */
export function normalizeLookupQuery(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

const LOOKUP_WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;

/** Selection -> lookup query for the select-and-look-up affordance (spec
 * §6.1). Only a single word (1-3 for a rare hyphenated/possessive form)
 * of letters/apostrophes/hyphens is eligible — a whole sentence or a
 * mixed-script selection returns null so no popover is shown for it. */
export function extractLookupWord(selection: string): string | null {
  const trimmed = selection.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return null;
  const candidate = words.length === 1 ? (words[0] ?? trimmed) : trimmed;
  if (!words.every((w) => LOOKUP_WORD_RE.test(w))) return null;
  return candidate;
}

/** Damerau-Levenshtein edit distance, capped: returns `max + 1` (never a
 * real distance) the moment the best-possible remaining path can't beat
 * `max`, so a long, wildly-different candidate against a big dictionary
 * index costs O(min(len,max)) rather than O(len^2). Used for "did you
 * mean" ranking (spec §5's resolution order, last step). */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const al = a.length;
  const bl = b.length;
  const prev2 = new Array<number>(bl + 1);
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, prev2[j - 2]! + 1);
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= bl; j++) prev2[j] = prev[j]!;
    [prev, curr] = [curr, prev];
  }
  return Math.min(prev[bl]!, max + 1);
}

/** Ctrl+D handler guard, shared between StudentConsole's keydown listener
 * and its own tests. Ignores: OS auto-repeat, any modifier beyond
 * Ctrl/Cmd, and typing focused in an editable element OTHER than the
 * dictionary's own search box (`data-dictionary-search`) — a typed-answer
 * activity's textarea must never have Ctrl+D hijacked out from under it
 * (spec §6.3). `dictionaryEnabled=false` also suppresses it so the
 * shortcut can't reopen a panel the current activity has turned off. */
export function shouldHandleDictionaryShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean },
  target: { tagName?: string; isContentEditable?: boolean; dataset?: { dictionarySearch?: string } } | null,
  dictionaryEnabled: boolean,
): boolean {
  if (!dictionaryEnabled) return false;
  if (event.repeat || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'd') return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (!target) return true;
  if (target.dataset?.dictionarySearch) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return false;
  return true;
}
