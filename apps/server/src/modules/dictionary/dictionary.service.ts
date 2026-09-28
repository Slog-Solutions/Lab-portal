import { Injectable } from '@nestjs/common';
import {
  boundedEditDistance,
  normalizeLookupQuery,
  type DictionaryEntry,
  type DictionaryLookupResult,
  type DictionaryMeta,
  type DictionaryPos,
  type DictionarySense,
} from '@lab/shared';
import { DictionaryStoreService, type DictionaryEntryRow, type DictionarySenseRow } from './dictionary-store.service';

const LOOKUP_CACHE_MAX = 2000;
const DID_YOU_MEAN_MAX_DISTANCE = 2;
const DID_YOU_MEAN_LIMIT = 5;

interface IndexRow {
  headwordLc: string;
  freqRank: number;
}

/**
 * The four routes' shared query logic (spec §5). Sits above
 * DictionaryStoreService (raw SQLite access) — this is where lookup
 * RESOLUTION order, caching, suggest ranking and did-you-mean live, none
 * of which the store itself knows about.
 */
@Injectable()
export class DictionaryService {
  // The corpus is static once loaded (spec: "cache invalidation is a
  // non-issue") — a plain insertion-ordered Map doubles as an LRU: a hit
  // is re-inserted to the end, and the oldest entry is evicted from the
  // front once the cache is full.
  private readonly lookupCache = new Map<string, DictionaryLookupResult>();
  private index: IndexRow[] | null = null;

  constructor(private readonly store: DictionaryStoreService) {}

  isAvailable(): boolean {
    return this.store.isAvailable();
  }

  meta(): DictionaryMeta {
    return this.store.getMetaInfo();
  }

  lookup(rawQuery: string): DictionaryLookupResult {
    const query = normalizeLookupQuery(rawQuery);
    if (!query) return this.notFound(query);

    const cached = this.lookupCache.get(query);
    if (cached) {
      // Re-insert to mark as most-recently-used.
      this.lookupCache.delete(query);
      this.lookupCache.set(query, cached);
      return cached;
    }

    const result = this.resolve(query);
    this.lookupCache.set(query, result);
    if (this.lookupCache.size > LOOKUP_CACHE_MAX) {
      const oldest = this.lookupCache.keys().next().value;
      if (oldest !== undefined) this.lookupCache.delete(oldest);
    }
    return result;
  }

  /** Type-ahead (spec §5 suggest, A4: <150ms). Not cached — the debounced
   * client already limits call volume, and a prefix range scan is cheap. */
  suggest(rawPrefix: string, limit: number): string[] {
    const prefix = normalizeLookupQuery(rawPrefix);
    if (!prefix) return [];
    return this.store.suggestByPrefix(prefix, limit).map((r) => r.headword_lc);
  }

  /** Reverse lookup — words whose definitions match (spec §5 search). */
  search(rawQuery: string, limit: number): string[] {
    const query = rawQuery.trim();
    if (!query) return [];
    const rows = this.store.searchDefinitions(query, limit);
    return Array.from(new Set(rows.map((r) => r.headword)));
  }

  // ---- Resolution (spec §5's order) ---------------------------------------

  private resolve(query: string): DictionaryLookupResult {
    const exact = this.store.findAllByHeadword(query);
    if (exact.length > 0) {
      return this.buildResult(query, exact, null);
    }

    const viaForm = this.store.findByForm(query);
    if (viaForm) {
      const siblings = this.store.findAllByHeadword(viaForm.headword_lc);
      return this.buildResult(query, siblings.length > 0 ? siblings : [viaForm], query);
    }

    const viaFts = this.store.ftsPrefixEntries(query);
    if (viaFts.length > 0) {
      const best = viaFts[0]!;
      const siblings = this.store.findAllByHeadword(best.headword_lc);
      return this.buildResult(query, siblings.length > 0 ? siblings : [best], query);
    }

    return this.notFound(query);
  }

  private buildResult(query: string, rows: DictionaryEntryRow[], resolvedFrom: string | null): DictionaryLookupResult {
    const headword = rows[0]!.headword;
    const ipa = rows.find((r) => r.ipa)?.ipa ?? null;
    const entries: DictionaryEntry[] = rows.map((row) => ({
      pos: row.pos as DictionaryPos,
      senses: this.store.sensesForEntry(row.id).map((s): DictionarySense => this.toSense(s)),
    }));
    return {
      found: true,
      query,
      headword,
      ipa,
      entries,
      resolvedFrom,
      suggestions: [],
      attribution: this.attribution(),
    };
  }

  private toSense(row: DictionarySenseRow): DictionarySense {
    let synonyms: string[] = [];
    try {
      const parsed = JSON.parse(row.synonyms) as unknown;
      if (Array.isArray(parsed)) synonyms = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      synonyms = [];
    }
    return {
      definition: row.definition,
      example: row.example,
      synonyms,
      source: row.source === 'wiktionary' ? 'wiktionary' : 'oewn',
    };
  }

  private notFound(query: string): DictionaryLookupResult {
    return {
      found: false,
      query,
      headword: null,
      ipa: null,
      entries: [],
      resolvedFrom: null,
      suggestions: query ? this.didYouMean(query) : [],
      attribution: this.attribution(),
    };
  }

  /** Ranked by edit distance then popularity (spec §5's last resolution
   * step) — built from a small in-memory index of every distinct
   * headword, loaded once and reused (the corpus never changes at
   * runtime). Restricting candidates to within +/-2 characters of the
   * query length before computing a real distance keeps this a fast scan
   * even over 100k+ headwords, since boundedEditDistance itself already
   * early-exits past the length check. */
  private didYouMean(query: string): string[] {
    const index = this.ensureIndex();
    const candidates: Array<{ headwordLc: string; distance: number; freqRank: number }> = [];
    for (const row of index) {
      if (Math.abs(row.headwordLc.length - query.length) > DID_YOU_MEAN_MAX_DISTANCE) continue;
      const distance = boundedEditDistance(query, row.headwordLc, DID_YOU_MEAN_MAX_DISTANCE);
      if (distance <= DID_YOU_MEAN_MAX_DISTANCE) candidates.push({ headwordLc: row.headwordLc, distance, freqRank: row.freqRank });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.freqRank - b.freqRank);
    return candidates.slice(0, DID_YOU_MEAN_LIMIT).map((c) => c.headwordLc);
  }

  private ensureIndex(): IndexRow[] {
    if (!this.index) {
      this.index = this.store.allHeadwords().map((r) => ({ headwordLc: r.headword_lc, freqRank: r.freq_rank ?? Number.MAX_SAFE_INTEGER }));
    }
    return this.index;
  }

  private attribution(): string {
    return this.store.getMetaInfo().attribution ?? 'Open English WordNet (CC BY 4.0), derived from Princeton WordNet.';
  }
}
