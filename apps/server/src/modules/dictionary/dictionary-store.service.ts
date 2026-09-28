import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'node:path';
import { DICTIONARY_META_KEYS, DICTIONARY_SCHEMA_VERSION, type DictionaryMeta, type DictionaryMetaKey } from '@lab/shared';
import type { EnvConfig } from '../../config/env.validation';

export interface DictionaryEntryRow {
  id: number;
  headword: string;
  headword_lc: string;
  pos: string;
  ipa: string | null;
  freq_rank: number | null;
}

export interface DictionarySenseRow {
  id: number;
  entry_id: number;
  ord: number;
  definition: string;
  example: string | null;
  synonyms: string;
  source: string;
}

/**
 * Opens `dictionary.db` (spec §5 "Implementation notes") READ-ONLY, with a
 * single shared connection — the corpus never changes at runtime, so
 * there is nothing to write and nothing to invalidate.
 *
 * Spec: "If the file is missing or the schema version is unsupported, the
 * module must start anyway and report available: false — a missing
 * dictionary must never block the server from booting." This mirrors the
 * exact degrade-honestly posture PronunciationService already established
 * for the optional eSpeak-NG/Piper binaries: `onModuleInit` swallows every
 * failure into `unavailableReason`, and every query method below checks
 * `isAvailable()` first rather than letting a null `db` throw.
 */
@Injectable()
export class DictionaryStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DictionaryStoreService.name);
  private db: DatabaseSync | null = null;
  private unavailableReason: string | null = null;
  private meta: Record<DictionaryMetaKey, string> | null = null;

  private stmtByHeadwordAll!: StatementSync;
  private stmtByForm!: StatementSync;
  private stmtSensesByEntry!: StatementSync;
  private stmtFtsPrefix!: StatementSync;
  private stmtAllHeadwords!: StatementSync;
  private stmtSuggestPrefix!: StatementSync;
  private stmtSearchDefinitions!: StatementSync;
  private stmtEntryById!: StatementSync;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  onModuleInit(): void {
    const dbPath = path.resolve(this.config.get('DICTIONARY_DB_PATH', { infer: true }));
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const metaRows = db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
      const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value])) as Record<DictionaryMetaKey, string>;
      const schemaVersion = Number(meta.schema_version ?? '0');
      if (schemaVersion !== DICTIONARY_SCHEMA_VERSION) {
        throw new Error(`unsupported schema_version ${schemaVersion} (server expects ${DICTIONARY_SCHEMA_VERSION})`);
      }

      this.db = db;
      this.meta = meta;
      this.prepareStatements(db);
      this.logger.log(`dictionary.db loaded from ${dbPath} (built ${meta.built_at ?? 'unknown'}, sources=${meta.sources ?? '?'})`);
    } catch (err) {
      // A failure AFTER the file opened (bad schema, corrupt meta table)
      // must not leak an open handle that this.db never took ownership
      // of — onModuleDestroy() only closes `this.db`, which stays null here.
      if (db && this.db !== db) db.close();
      this.unavailableReason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Dictionary unavailable (${dbPath}): ${this.unavailableReason} — lookups will report available:false`);
    }
  }

  /** Releases the file handle. Node's own process exit does this anyway,
   * but a Windows file-locking-sensitive test suite (rmSync on a temp dir
   * holding an open .db) needs it explicitly, and a clean Nest shutdown
   * should not leave the handle open regardless. */
  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  private prepareStatements(db: DatabaseSync): void {
    // A headword_lc can have several `entry` rows — one per POS (spec §4.3:
    // "run" the verb and "run" the noun are separate rows). ORDER BY pos so
    // a lookup's entries[] array is in a stable, deterministic order.
    this.stmtByHeadwordAll = db.prepare('SELECT * FROM entry WHERE headword_lc = ? ORDER BY pos ASC');
    this.stmtByForm = db.prepare(
      'SELECT e.* FROM entry e JOIN form f ON f.entry_id = e.id WHERE f.form_lc = ? LIMIT 1',
    );
    this.stmtSensesByEntry = db.prepare('SELECT * FROM sense WHERE entry_id = ? ORDER BY ord ASC');
    this.stmtFtsPrefix = db.prepare(
      `SELECT DISTINCT e.* FROM entry_fts fts JOIN sense s ON s.id = fts.rowid JOIN entry e ON e.id = s.entry_id
       WHERE fts.headword MATCH ? ORDER BY e.freq_rank ASC LIMIT 5`,
    );
    this.stmtAllHeadwords = db.prepare('SELECT DISTINCT headword_lc, freq_rank FROM entry ORDER BY headword_lc ASC');
    this.stmtSuggestPrefix = db.prepare(
      `SELECT DISTINCT headword_lc, MIN(freq_rank) as freq_rank FROM entry
       WHERE headword_lc >= ? AND headword_lc < ? GROUP BY headword_lc ORDER BY freq_rank ASC LIMIT ?`,
    );
    this.stmtSearchDefinitions = db.prepare(
      `SELECT DISTINCT e.* FROM entry_fts fts JOIN sense s ON s.id = fts.rowid JOIN entry e ON e.id = s.entry_id
       WHERE fts.definition MATCH ? ORDER BY e.freq_rank ASC LIMIT ?`,
    );
    this.stmtEntryById = db.prepare('SELECT * FROM entry WHERE id = ?');
  }

  isAvailable(): boolean {
    return this.db !== null;
  }

  getMetaInfo(): DictionaryMeta {
    if (!this.db || !this.meta) {
      return { available: false, reason: this.unavailableReason ?? 'dictionary.db not loaded' };
    }
    let sources: string[] | undefined;
    try {
      sources = JSON.parse(this.meta.sources ?? '[]') as string[];
    } catch {
      sources = undefined;
    }
    return {
      available: true,
      schemaVersion: Number(this.meta.schema_version),
      builtAt: this.meta.built_at,
      sources,
      licenceMode: this.meta.licence_mode as DictionaryMeta['licenceMode'],
      oewnVersion: this.meta.oewn_version,
      attribution: this.meta.attribution,
      licenceText: this.meta.licence_text,
    };
  }

  /** Every meta key this store recognizes, for a debug/about surface that
   * wants the raw table rather than the shaped DictionaryMeta above. */
  static readonly META_KEYS = DICTIONARY_META_KEYS;

  findAllByHeadword(headwordLc: string): DictionaryEntryRow[] {
    return this.stmtByHeadwordAll.all(headwordLc) as unknown as DictionaryEntryRow[];
  }

  findByForm(formLc: string): DictionaryEntryRow | undefined {
    return this.stmtByForm.get(formLc) as DictionaryEntryRow | undefined;
  }

  findById(entryId: number): DictionaryEntryRow | undefined {
    return this.stmtEntryById.get(entryId) as DictionaryEntryRow | undefined;
  }

  sensesForEntry(entryId: number): DictionarySenseRow[] {
    return this.stmtSensesByEntry.all(entryId) as unknown as DictionarySenseRow[];
  }

  /** FTS5 prefix match on headword, for the last resolution step (spec
   * §5: "FTS5 prefix -> nothing found"). `raw*` performs a genuine prefix
   * match under FTS5's default tokenizer. */
  ftsPrefixEntries(prefixLc: string): DictionaryEntryRow[] {
    return this.stmtFtsPrefix.all(`${escapeFtsToken(prefixLc)}*`) as unknown as DictionaryEntryRow[];
  }

  /** Every distinct headword + freq_rank, loaded once at boot for the
   * in-memory did-you-mean/suggest index (see DictionaryService). */
  allHeadwords(): Array<{ headword_lc: string; freq_rank: number | null }> {
    return this.stmtAllHeadwords.all() as unknown as Array<{ headword_lc: string; freq_rank: number | null }>;
  }

  /** Type-ahead (spec §5 suggest, A4): a real range scan over the sorted
   * headword_lc index — `[prefix, prefix + '￿')` — rather than a
   * `LIKE 'prefix%'` scan, so it stays an index range seek under load. */
  suggestByPrefix(prefixLc: string, limit: number): Array<{ headword_lc: string; freq_rank: number | null }> {
    return this.stmtSuggestPrefix.all(prefixLc, `${prefixLc}￿`, limit) as unknown as Array<{
      headword_lc: string;
      freq_rank: number | null;
    }>;
  }

  /** Reverse lookup — "find words whose definitions match" (spec §5 search). */
  searchDefinitions(query: string, limit: number): DictionaryEntryRow[] {
    return this.stmtSearchDefinitions.all(sanitizeFtsQuery(query), limit) as unknown as DictionaryEntryRow[];
  }
}

/** FTS5 MATCH treats `"`, `*`, `:`, `-`, `(`, `)` etc. as query syntax —
 * a headword token itself never contains any of these (see the schema's
 * `headword_lc`), so a single word is quoted defensively before appending
 * the trailing `*` for a prefix match. */
function escapeFtsToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/** Reverse-lookup search text comes from a free-text query box, unlike a
 * single headword token — every word is quoted and AND-ed together so a
 * user's punctuation/operators can never be interpreted as FTS5 query
 * syntax (spec's own security posture: this is untrusted user input). */
function sanitizeFtsQuery(text: string): string {
  const words = text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (words.length === 0) return '""';
  return words.map((w) => escapeFtsToken(w)).join(' AND ');
}
