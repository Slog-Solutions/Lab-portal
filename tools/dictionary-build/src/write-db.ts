import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { DICTIONARY_SCHEMA_SQL, DICTIONARY_SCHEMA_VERSION } from '@lab/shared';
import type { RankedEntry } from './types.js';

export interface WriteDbOptions {
  outPath: string;
  sources: ('oewn' | 'wiktionary')[];
  licenceMode: 'oewn' | 'oewn,wiktionary';
  oewnVersion: string;
  wiktionaryDump?: string;
  /** ISO timestamp. Callers pass a fixed value (not `new Date()`) when
   * reproducibility (spec A12) needs the resulting file byte-identical
   * across two runs of the same inputs; cli.ts defaults it from
   * dictionary-sources.json's own recorded build date otherwise. */
  builtAt: string;
}

// Spec §9 "Required wording for OEWN: attribution to both Princeton
// WordNet and the Open English WordNet team." — this exact sentence is
// what the spec's own §5 response-shape example uses for `attribution`;
// kept identical here rather than reworded.
export const ATTRIBUTION_TEXT = 'Open English WordNet (CC BY 4.0), derived from Princeton WordNet.';

export function buildLicenceText(oewnVersion: string, licenceMode: WriteDbOptions['licenceMode']): string {
  const lines = [
    `This dictionary is built from the Open English WordNet (https://github.com/globalwordnet/english-wordnet), version ${oewnVersion}, licensed under Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/`,
    '',
    'Open English WordNet is derived from the Princeton WordNet (https://wordnet.princeton.edu/), used under the WordNet License: https://wordnet.princeton.edu/license-and-commercial-use',
    '',
    'Attribution: "This work is based on WordNet, Princeton University, and on the Open English WordNet (https://github.com/globalwordnet/english-wordnet), licensed under CC BY 4.0."',
  ];
  if (licenceMode === 'oewn,wiktionary') {
    lines.push(
      '',
      'This build also includes data derived from English Wiktionary (via kaikki.org), licensed under CC BY-SA 4.0. Because of this, this dictionary DATABASE FILE is itself licensed under CC BY-SA 4.0 — any adapted version of it must be released under the same licence. This does not apply to the application code that reads it.',
    );
  }
  return lines.join('\n');
}

/**
 * Writes the SQLite file (spec §4.2 step 7, §4.3 schema). Deterministic
 * given the same `entries` + `options` (fixed `builtAt`, ids assigned in
 * `(headword_lc, pos)` order) — required for the reproducible-build
 * acceptance test (A12): rebuild from the same recorded inputs, get the
 * same headword count and (per manifest.ts) the same content checksum.
 */
export function writeDictionaryDb(entries: RankedEntry[], options: WriteDbOptions): void {
  const dir = path.dirname(options.outPath);
  mkdirSync(dir, { recursive: true });
  if (existsSync(options.outPath)) unlinkSync(options.outPath);

  const db = new DatabaseSync(options.outPath);
  try {
    db.exec(DICTIONARY_SCHEMA_SQL);

    const sorted = [...entries].sort((a, b) => a.headwordLc.localeCompare(b.headwordLc) || a.pos.localeCompare(b.pos));

    const insertEntry = db.prepare('INSERT INTO entry (id, headword, headword_lc, pos, ipa, freq_rank) VALUES (?, ?, ?, ?, ?, ?)');
    const insertSense = db.prepare(
      'INSERT INTO sense (id, entry_id, ord, definition, example, synonyms, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insertForm = db.prepare('INSERT INTO form (form_lc, entry_id) VALUES (?, ?)');
    const insertFts = db.prepare('INSERT INTO entry_fts (rowid, headword, definition) VALUES (?, ?, ?)');

    db.exec('BEGIN');
    let entryId = 1;
    let senseId = 1;
    for (const e of sorted) {
      insertEntry.run(entryId, e.headword, e.headwordLc, e.pos, e.ipa, e.freqRank);
      for (const s of e.senses) {
        insertSense.run(senseId, entryId, s.ord, s.definition, s.example, JSON.stringify(s.synonyms), s.source);
        insertFts.run(senseId, e.headword, s.definition);
        senseId++;
      }
      const uniqueForms = new Set(e.forms);
      for (const f of uniqueForms) {
        insertForm.run(f, entryId);
      }
      entryId++;
    }
    db.exec('COMMIT');

    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insertMeta.run('schema_version', String(DICTIONARY_SCHEMA_VERSION));
    insertMeta.run('built_at', options.builtAt);
    insertMeta.run('sources', JSON.stringify(options.sources));
    insertMeta.run('licence_mode', options.licenceMode);
    insertMeta.run('oewn_version', options.oewnVersion);
    if (options.wiktionaryDump) insertMeta.run('wiktionary_dump', options.wiktionaryDump);
    insertMeta.run('attribution', ATTRIBUTION_TEXT);
    insertMeta.run('licence_text', buildLicenceText(options.oewnVersion, options.licenceMode));

    db.exec('VACUUM');
  } finally {
    db.close();
  }
}
