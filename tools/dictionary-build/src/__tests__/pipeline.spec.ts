import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseWnLmf } from '../oewn/parse-lmf.js';
import { rankEntries } from '../rank.js';
import { writeDictionaryDb } from '../write-db.js';
import { writeManifest } from '../manifest.js';
import { runQualityGate } from '../quality-gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(path.resolve(HERE, '../../fixtures/mini-oewn.xml'), 'utf-8');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dict-pipeline-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** End-to-end: fixture XML -> parse -> rank -> write SQLite -> manifest.
 * Exercises the exact sequence cli.ts runs for a real build, just against
 * the small fixture instead of the real multi-hundred-MB OEWN release
 * this sandbox has no way to download (see fetch-inputs.ts's own doc
 * comment) — a real build must still be run and gated against the actual
 * spec §4.4 thresholds (>= 50,000 headwords, etc.) before shipping. */
function runPipeline(outPath: string, builtAt: string) {
  const parsed = parseWnLmf(FIXTURE_XML);
  const ranked = rankEntries(parsed.entries);
  writeDictionaryDb(ranked.entries, { outPath, sources: ['oewn'], licenceMode: 'oewn', oewnVersion: 'test-fixture-1', builtAt });
  return ranked;
}

describe('the full pipeline against the fixture', () => {
  it('produces a queryable SQLite file with the schema the server expects', () => {
    const outPath = path.join(dir, 'dictionary.db');
    runPipeline(outPath, '2026-09-28T00:00:00.000Z');

    const db = new DatabaseSync(outPath, { readOnly: true });
    try {
      const run = db.prepare('SELECT * FROM entry WHERE headword_lc = ?').get('run') as Record<string, unknown>;
      expect(run).toBeDefined();
      expect(run.pos).toBe('verb');

      const senses = db.prepare('SELECT * FROM sense WHERE entry_id = ? ORDER BY ord').all(run.id as number);
      expect(senses.length).toBe(2); // archaic sense dropped by rank.ts

      const viaForm = db.prepare('SELECT entry_id FROM form WHERE form_lc = ?').get('ran') as { entry_id: number } | undefined;
      expect(viaForm?.entry_id).toBe(run.id);

      const ftsHit = db.prepare("SELECT rowid FROM entry_fts WHERE entry_fts MATCH 'headword:run'").all();
      expect(ftsHit.length).toBeGreaterThan(0);

      const meta = Object.fromEntries(
        (db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
      );
      expect(meta.licence_mode).toBe('oewn');
      expect(meta.attribution).toContain('Open English WordNet');
      expect(meta.attribution).toContain('Princeton WordNet');
    } finally {
      db.close();
    }
  });

  it('passes the quality gate against the words the fixture actually covers', () => {
    const outPath = path.join(dir, 'dictionary.db');
    runPipeline(outPath, '2026-09-28T00:00:00.000Z');
    const fixtureWords = ['run', 'running', 'ran', 'runs', 'mouse', 'mice', 'resolve'];
    const report = runQualityGate({ dbPath: outPath, minHeadwords: 5, spotCheckWords: fixtureWords });
    expect(report.passed).toBe(true);
  });

  it('is reproducible: same inputs + same builtAt -> identical manifest content hash (spec A12)', () => {
    const outPathA = path.join(dir, 'a.db');
    const outPathB = path.join(dir, 'b.db');
    runPipeline(outPathA, '2026-09-28T00:00:00.000Z');
    runPipeline(outPathB, '2026-09-28T00:00:00.000Z');

    const manifestA = writeManifest({
      dbPath: outPathA,
      manifestPath: path.join(dir, 'a.manifest.json'),
      sources: ['oewn'],
      licenceMode: 'oewn',
      oewnVersion: 'test-fixture-1',
      builtAt: '2026-09-28T00:00:00.000Z',
    });
    const manifestB = writeManifest({
      dbPath: outPathB,
      manifestPath: path.join(dir, 'b.manifest.json'),
      sources: ['oewn'],
      licenceMode: 'oewn',
      oewnVersion: 'test-fixture-1',
      builtAt: '2026-09-28T00:00:00.000Z',
    });

    expect(manifestA.contentSha256).toBe(manifestB.contentSha256);
    expect(manifestA.headwordCount).toBe(manifestB.headwordCount);
  });
});
