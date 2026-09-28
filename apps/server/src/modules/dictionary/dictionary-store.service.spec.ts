import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DICTIONARY_SCHEMA_SQL, DICTIONARY_SCHEMA_VERSION } from '@lab/shared';
import { DictionaryStoreService } from './dictionary-store.service';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

let dir: string;
let dbPath: string;
// node:sqlite keeps the file open for the store's lifetime (by design —
// see DictionaryStoreService's own doc comment) — Windows won't let
// rmSync delete a temp dir holding an open file handle, so every store
// created in a test is tracked here and explicitly closed before cleanup.
let stores: DictionaryStoreService[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dict-store-'));
  dbPath = path.join(dir, 'dictionary.db');
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.onModuleDestroy();
  rmSync(dir, { recursive: true, force: true });
});

function makeStore(path_: string): DictionaryStoreService {
  const store = new DictionaryStoreService(makeConfig(path_));
  stores.push(store);
  return store;
}

function seedDb(path_: string, opts: { schemaVersion?: number } = {}): void {
  const db = new DatabaseSync(path_);
  db.exec(DICTIONARY_SCHEMA_SQL);

  const insertEntry = db.prepare('INSERT INTO entry (id, headword, headword_lc, pos, ipa, freq_rank) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSense = db.prepare('INSERT INTO sense (id, entry_id, ord, definition, example, synonyms, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertForm = db.prepare('INSERT INTO form (form_lc, entry_id) VALUES (?, ?)');
  const insertFts = db.prepare('INSERT INTO entry_fts (rowid, headword, definition) VALUES (?, ?, ?)');

  // run (verb) — two senses, one form-mapped irregular ("ran")
  insertEntry.run(1, 'run', 'run', 'verb', 'rʌn', 1);
  insertSense.run(1, 1, 1, "move fast by using one's feet", 'She ran to the store.', '["scurry"]', 'oewn');
  insertSense.run(2, 1, 2, 'direct or control a business', null, '[]', 'oewn');
  insertForm.run('ran', 1);
  insertForm.run('running', 1);
  insertForm.run('runs', 1);
  insertFts.run(1, 'run', "move fast by using one's feet");
  insertFts.run(2, 'run', 'direct or control a business');

  // run (noun) — same headword_lc, different POS
  insertEntry.run(2, 'run', 'run', 'noun', null, 1);
  insertSense.run(3, 2, 1, 'an act of running', null, '[]', 'oewn');
  insertFts.run(3, 'run', 'an act of running');

  // mouse (noun) — irregular plural
  insertEntry.run(3, 'mouse', 'mouse', 'noun', null, 5);
  insertSense.run(4, 3, 1, 'a small rodent', null, '[]', 'oewn');
  insertForm.run('mice', 3);
  insertFts.run(4, 'mouse', 'a small rodent');

  // runner — shares the "run" prefix, distinct headword
  insertEntry.run(4, 'runner', 'runner', 'noun', null, 20);
  insertSense.run(5, 4, 1, 'a person who runs', null, '[]', 'oewn');
  insertFts.run(5, 'runner', 'a person who runs');

  const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  insertMeta.run('schema_version', String(opts.schemaVersion ?? DICTIONARY_SCHEMA_VERSION));
  insertMeta.run('built_at', '2026-09-28T00:00:00.000Z');
  insertMeta.run('sources', JSON.stringify(['oewn']));
  insertMeta.run('licence_mode', 'oewn');
  insertMeta.run('oewn_version', 'test');
  insertMeta.run('attribution', 'Open English WordNet (CC BY 4.0), derived from Princeton WordNet.');
  insertMeta.run('licence_text', 'full licence text here');
  db.close();
}

function makeConfig(path_: string): ConfigService<EnvConfig, true> {
  return { get: () => path_ } as unknown as ConfigService<EnvConfig, true>;
}

describe('DictionaryStoreService', () => {
  it('reports unavailable when the file does not exist', () => {
    const store = makeStore(path.join(dir, 'does-not-exist.db'));
    store.onModuleInit();
    expect(store.isAvailable()).toBe(false);
    const meta = store.getMetaInfo();
    expect(meta.available).toBe(false);
    expect(meta.reason).toBeTruthy();
  });

  it('reports unavailable on an unsupported schema version, without throwing', () => {
    seedDb(dbPath, { schemaVersion: 999 });
    const store = makeStore(dbPath);
    expect(() => store.onModuleInit()).not.toThrow();
    expect(store.isAvailable()).toBe(false);
    expect(store.getMetaInfo().reason).toContain('schema_version');
  });

  it('loads a valid file and exposes its meta', () => {
    seedDb(dbPath);
    const store = makeStore(dbPath);
    store.onModuleInit();
    expect(store.isAvailable()).toBe(true);
    const meta = store.getMetaInfo();
    expect(meta.available).toBe(true);
    expect(meta.licenceMode).toBe('oewn');
    expect(meta.attribution).toContain('Princeton WordNet');
  });

  describe('queries, against a loaded store', () => {
    let store: DictionaryStoreService;
    beforeEach(() => {
      seedDb(dbPath);
      store = makeStore(dbPath);
      store.onModuleInit();
    });

    it('finds every POS row for a headword', () => {
      const rows = store.findAllByHeadword('run');
      expect(rows.map((r) => r.pos).sort()).toEqual(['noun', 'verb']);
    });

    it('resolves a form to its entry', () => {
      const row = store.findByForm('ran');
      expect(row?.headword_lc).toBe('run');
      const mouse = store.findByForm('mice');
      expect(mouse?.headword_lc).toBe('mouse');
    });

    it('returns undefined for an unknown form', () => {
      expect(store.findByForm('zzzznotaword')).toBeUndefined();
    });

    it('orders senses by ord', () => {
      const senses = store.sensesForEntry(1);
      expect(senses.map((s) => s.ord)).toEqual([1, 2]);
    });

    it('prefix-matches headwords via FTS5, ordered by freq_rank', () => {
      const rows = store.ftsPrefixEntries('run');
      const headwords = rows.map((r) => r.headword_lc);
      expect(headwords).toContain('run');
      expect(headwords).toContain('runner');
      // "run" (freq_rank 1) must sort ahead of "runner" (freq_rank 20).
      expect(headwords.indexOf('run')).toBeLessThan(headwords.indexOf('runner'));
    });

    it('does not let FTS5 query syntax in the query leak through', () => {
      expect(() => store.ftsPrefixEntries('run" OR "x')).not.toThrow();
    });

    it('range-scans a prefix for suggest', () => {
      const suggestions = store.suggestByPrefix('run', 8).map((r) => r.headword_lc);
      expect(suggestions.sort()).toEqual(['run', 'runner']);
    });

    it('searches definitions and sanitizes free-text input', () => {
      const rows = store.searchDefinitions('rodent', 5);
      expect(rows.map((r) => r.headword_lc)).toEqual(['mouse']);
      expect(() => store.searchDefinitions('rodent" AND "x OR 1=1', 5)).not.toThrow();
    });

    it('lists every distinct headword for the in-memory index', () => {
      const all = store.allHeadwords().map((r) => r.headword_lc);
      expect(new Set(all)).toEqual(new Set(['run', 'mouse', 'runner']));
    });
  });
});
