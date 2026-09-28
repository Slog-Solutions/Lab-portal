import { describe, expect, it, vi } from 'vitest';
import { DictionaryService } from './dictionary.service';
import type { DictionaryEntryRow, DictionarySenseRow, DictionaryStoreService } from './dictionary-store.service';

const RUN_VERB: DictionaryEntryRow = { id: 1, headword: 'run', headword_lc: 'run', pos: 'verb', ipa: 'rʌn', freq_rank: 1 };
const RUN_NOUN: DictionaryEntryRow = { id: 2, headword: 'run', headword_lc: 'run', pos: 'noun', ipa: null, freq_rank: 1 };
const MOUSE_NOUN: DictionaryEntryRow = { id: 3, headword: 'mouse', headword_lc: 'mouse', pos: 'noun', ipa: null, freq_rank: 5 };
const RUNNER_NOUN: DictionaryEntryRow = { id: 4, headword: 'runner', headword_lc: 'runner', pos: 'noun', ipa: null, freq_rank: 20 };

const SENSES: Record<number, DictionarySenseRow[]> = {
  1: [
    { id: 1, entry_id: 1, ord: 1, definition: "move fast by using one's feet", example: 'She ran to the store.', synonyms: '["scurry"]', source: 'oewn' },
    { id: 2, entry_id: 1, ord: 2, definition: 'direct or control a business', example: null, synonyms: '[]', source: 'oewn' },
  ],
  2: [{ id: 3, entry_id: 2, ord: 1, definition: 'an act of running', example: null, synonyms: '[]', source: 'oewn' }],
  3: [{ id: 4, entry_id: 3, ord: 1, definition: 'a small rodent', example: null, synonyms: '[]', source: 'oewn' }],
  4: [{ id: 5, entry_id: 4, ord: 1, definition: 'a person who runs', example: null, synonyms: '[]', source: 'oewn' }],
};

function makeFakeStore(overrides: Partial<Record<keyof DictionaryStoreService, unknown>> = {}) {
  const byHeadwordLc: Record<string, DictionaryEntryRow[]> = {
    run: [RUN_VERB, RUN_NOUN],
    mouse: [MOUSE_NOUN],
    runner: [RUNNER_NOUN],
  };
  const formByLc: Record<string, DictionaryEntryRow> = { ran: RUN_VERB, running: RUN_VERB, runs: RUN_VERB, mice: MOUSE_NOUN };

  return {
    isAvailable: vi.fn().mockReturnValue(true),
    getMetaInfo: vi.fn().mockReturnValue({ available: true, attribution: 'Open English WordNet (CC BY 4.0), derived from Princeton WordNet.' }),
    findAllByHeadword: vi.fn((lc: string) => byHeadwordLc[lc] ?? []),
    findByForm: vi.fn((lc: string) => formByLc[lc]),
    sensesForEntry: vi.fn((id: number) => SENSES[id] ?? []),
    ftsPrefixEntries: vi.fn(() => [] as DictionaryEntryRow[]),
    allHeadwords: vi.fn(() => [
      { headword_lc: 'run', freq_rank: 1 },
      { headword_lc: 'mouse', freq_rank: 5 },
      { headword_lc: 'runner', freq_rank: 20 },
    ]),
    suggestByPrefix: vi.fn(() => [] as Array<{ headword_lc: string; freq_rank: number | null }>),
    searchDefinitions: vi.fn(() => [] as DictionaryEntryRow[]),
    ...overrides,
  } as unknown as DictionaryStoreService;
}

describe('DictionaryService.lookup', () => {
  it('resolves an exact headword across every POS', () => {
    const service = new DictionaryService(makeFakeStore());
    const result = service.lookup('run');
    expect(result.found).toBe(true);
    expect(result.headword).toBe('run');
    expect(result.resolvedFrom).toBeNull();
    expect(result.ipa).toBe('rʌn');
    expect(result.entries.map((e) => e.pos).sort()).toEqual(['noun', 'verb']);
  });

  it('resolves an inflected form to the full headword (A3)', () => {
    const service = new DictionaryService(makeFakeStore());
    for (const form of ['running', 'ran', 'runs']) {
      const result = service.lookup(form);
      expect(result.found).toBe(true);
      expect(result.headword).toBe('run');
      expect(result.resolvedFrom).toBe(form);
    }
  });

  it('normalizes the query before resolving (case, punctuation, whitespace)', () => {
    const service = new DictionaryService(makeFakeStore());
    expect(service.lookup('  Run.  ').found).toBe(true);
  });

  it('falls back to an FTS5 prefix match and expands to sibling POS entries', () => {
    const store = makeFakeStore({ ftsPrefixEntries: vi.fn(() => [RUN_VERB]) });
    const service = new DictionaryService(store);
    const result = service.lookup('runnn');
    expect(result.found).toBe(true);
    expect(result.headword).toBe('run');
    expect(result.resolvedFrom).toBe('runnn');
  });

  it('returns a clean not-found with suggestions for a nonsense word (A5)', () => {
    const service = new DictionaryService(makeFakeStore());
    const result = service.lookup('zzxxqqnonsense');
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.suggestions).toEqual([]); // too far from every real headword
  });

  it('suggests a close-edit-distance headword as "did you mean"', () => {
    const service = new DictionaryService(makeFakeStore());
    const result = service.lookup('moose'); // 1 substitution away from "mouse"
    expect(result.found).toBe(false);
    expect(result.suggestions).toContain('mouse');
  });

  it('caches a repeated lookup rather than re-querying the store', () => {
    const store = makeFakeStore();
    const service = new DictionaryService(store);
    service.lookup('run');
    service.lookup('run');
    expect(store.findAllByHeadword).toHaveBeenCalledTimes(1);
  });

  it('parses the synonyms JSON column into an array', () => {
    const service = new DictionaryService(makeFakeStore());
    const result = service.lookup('run');
    const verbEntry = result.entries.find((e) => e.pos === 'verb')!;
    expect(verbEntry.senses[0]!.synonyms).toEqual(['scurry']);
  });
});

describe('DictionaryService.suggest', () => {
  it('delegates to the store\'s prefix scan', () => {
    const store = makeFakeStore({ suggestByPrefix: vi.fn(() => [{ headword_lc: 'run', freq_rank: 1 }, { headword_lc: 'runner', freq_rank: 20 }]) });
    const service = new DictionaryService(store);
    expect(service.suggest('run', 8)).toEqual(['run', 'runner']);
  });

  it('returns nothing for an empty prefix', () => {
    const service = new DictionaryService(makeFakeStore());
    expect(service.suggest('   ', 8)).toEqual([]);
  });
});

describe('DictionaryService.search', () => {
  it('de-duplicates headwords across multiple matching senses', () => {
    const store = makeFakeStore({ searchDefinitions: vi.fn(() => [RUN_VERB, RUN_NOUN]) });
    const service = new DictionaryService(store);
    expect(service.search('run', 20)).toEqual(['run']);
  });
});

describe('DictionaryService.meta', () => {
  it('passes through the store\'s meta info', () => {
    const service = new DictionaryService(makeFakeStore());
    expect(service.meta().available).toBe(true);
  });
});
