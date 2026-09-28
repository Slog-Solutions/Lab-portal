import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DICTIONARY_SCHEMA_SQL } from '@lab/shared';
import { runQualityGate } from './quality-gate.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dict-gate-'));
  dbPath = path.join(dir, 'test.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a minimal, fully-controlled dictionary.db for testing the gate's
 * own pass/fail logic in isolation from the real parse/rank pipeline. */
function seedDb(rows: Array<{ headword: string; pos: string; ipa: string | null; freqRank: number; definition: string; forms?: string[] }>): void {
  const db = new DatabaseSync(dbPath);
  db.exec(DICTIONARY_SCHEMA_SQL);
  const insertEntry = db.prepare('INSERT INTO entry (id, headword, headword_lc, pos, ipa, freq_rank) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSense = db.prepare('INSERT INTO sense (id, entry_id, ord, definition, example, synonyms, source) VALUES (?, ?, 1, ?, NULL, ?, ?)');
  const insertForm = db.prepare('INSERT INTO form (form_lc, entry_id) VALUES (?, ?)');
  rows.forEach((r, i) => {
    const id = i + 1;
    insertEntry.run(id, r.headword, r.headword.toLowerCase(), r.pos, r.ipa, r.freqRank);
    insertSense.run(id, id, r.definition, '[]', 'oewn');
    for (const f of r.forms ?? []) insertForm.run(f, id);
  });
  db.close();
}

describe('runQualityGate', () => {
  it('fails when there are fewer headwords than required', () => {
    seedDb([{ headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move fast' }]);
    const report = runQualityGate({ dbPath, minHeadwords: 5 });
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('headwords'))).toBe(true);
  });

  it('passes when the headword count meets the threshold and everything else is clean', () => {
    seedDb(
      Array.from({ length: 5 }, (_, i) => ({ headword: `word${i}`, pos: 'noun', ipa: null, freqRank: i + 1, definition: 'a clean definition' })),
    );
    const report = runQualityGate({ dbPath, minHeadwords: 5 });
    expect(report.passed).toBe(true);
    expect(report.headwordCount).toBe(5);
  });

  it('fails on a sense with leftover markup', () => {
    seedDb([
      { headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move {{fast}}' },
      { headword: 'walk', pos: 'verb', ipa: null, freqRank: 2, definition: 'move slowly' },
    ]);
    const report = runQualityGate({ dbPath, minHeadwords: 2 });
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('markup'))).toBe(true);
  });

  it('fails on an empty or overlong definition', () => {
    seedDb([
      { headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: '' },
      { headword: 'walk', pos: 'verb', ipa: null, freqRank: 2, definition: 'x'.repeat(400) },
    ]);
    const report = runQualityGate({ dbPath, minHeadwords: 2 });
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('definition'))).toBe(true);
  });

  it('reports IPA coverage without failing the build when not enforced (OEWN-only mode)', () => {
    seedDb([{ headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move fast' }]);
    const report = runQualityGate({ dbPath, minHeadwords: 1, enforceIpaCoverage: false });
    expect(report.passed).toBe(true);
    expect(report.ipaCoveragePctTop10k).toBe(0);
  });

  it('fails IPA coverage when enforced and below threshold', () => {
    seedDb([{ headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move fast' }]);
    const report = runQualityGate({ dbPath, minHeadwords: 1, enforceIpaCoverage: true, minIpaCoveragePct: 60 });
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('IPA'))).toBe(true);
  });

  it('resolves a spot-check word via the headword or a form', () => {
    seedDb([{ headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move fast', forms: ['ran', 'running', 'runs'] }]);
    const report = runQualityGate({ dbPath, minHeadwords: 1, spotCheckWords: ['run', 'running', 'ran', 'runs'] });
    expect(report.passed).toBe(true);
    expect(report.spotCheckFailures).toEqual([]);
  });

  it('fails when a spot-check word resolves to nothing', () => {
    seedDb([{ headword: 'run', pos: 'verb', ipa: null, freqRank: 1, definition: 'move fast' }]);
    const report = runQualityGate({ dbPath, minHeadwords: 1, spotCheckWords: ['run', 'nonexistentword'] });
    expect(report.passed).toBe(false);
    expect(report.spotCheckFailures).toEqual(['nonexistentword']);
  });
});
