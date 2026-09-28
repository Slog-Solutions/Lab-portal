import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface ManifestOptions {
  dbPath: string;
  manifestPath: string;
  sources: string[];
  licenceMode: string;
  oewnVersion: string;
  builtAt: string;
}

export interface DictionaryManifest {
  builtAt: string;
  sources: string[];
  licenceMode: string;
  oewnVersion: string;
  headwordCount: number;
  senseCount: number;
  formCount: number;
  fileSizeBytes: number;
  fileSha256: string;
  contentSha256: string;
}

interface EntryRow {
  id: number;
  headword: string;
  headword_lc: string;
  pos: string;
  ipa: string | null;
  freq_rank: number;
}
interface SenseRow {
  id: number;
  entry_id: number;
  ord: number;
  definition: string;
  example: string | null;
  synonyms: string;
  source: string;
}
interface FormRow {
  form_lc: string;
  entry_id: number;
}

/**
 * Spec §4.1 "Builds must be reproducible and auditable" (A12): writes
 * `dictionary.manifest.json` alongside `dictionary.db` with counts, the
 * raw file's own SHA-256 (for a plain file-integrity check on transfer to
 * the lab server) and a separate CONTENT hash — a canonical text dump of
 * every row, ordered by id — which stays stable across SQLite versions
 * and page-layout differences the raw file hash would not. Rebuilding
 * from the same recorded inputs (dictionary-sources.json) must reproduce
 * the same headwordCount and contentSha256.
 */
export function writeManifest(options: ManifestOptions): DictionaryManifest {
  const fileBuffer = readFileSync(options.dbPath);
  const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex');
  const fileSizeBytes = statSync(options.dbPath).size;

  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  let headwordCount: number;
  let senseCount: number;
  let formCount: number;
  let contentSha256: string;
  try {
    headwordCount = (db.prepare('SELECT COUNT(*) AS n FROM entry').get() as { n: number }).n;
    senseCount = (db.prepare('SELECT COUNT(*) AS n FROM sense').get() as { n: number }).n;
    formCount = (db.prepare('SELECT COUNT(*) AS n FROM form').get() as { n: number }).n;

    const hash = createHash('sha256');
    const entries = db.prepare('SELECT id, headword, headword_lc, pos, ipa, freq_rank FROM entry ORDER BY id').all() as unknown as EntryRow[];
    for (const e of entries) hash.update(`E|${e.id}|${e.headword}|${e.headword_lc}|${e.pos}|${e.ipa ?? ''}|${e.freq_rank}\n`);
    const senses = db
      .prepare('SELECT id, entry_id, ord, definition, example, synonyms, source FROM sense ORDER BY id')
      .all() as unknown as SenseRow[];
    for (const s of senses) hash.update(`S|${s.id}|${s.entry_id}|${s.ord}|${s.definition}|${s.example ?? ''}|${s.synonyms}|${s.source}\n`);
    const forms = db.prepare('SELECT form_lc, entry_id FROM form ORDER BY entry_id, form_lc').all() as unknown as FormRow[];
    for (const f of forms) hash.update(`F|${f.form_lc}|${f.entry_id}\n`);
    contentSha256 = hash.digest('hex');
  } finally {
    db.close();
  }

  const manifest: DictionaryManifest = {
    builtAt: options.builtAt,
    sources: options.sources,
    licenceMode: options.licenceMode,
    oewnVersion: options.oewnVersion,
    headwordCount,
    senseCount,
    formCount,
    fileSizeBytes,
    fileSha256,
    contentSha256,
  };
  writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
