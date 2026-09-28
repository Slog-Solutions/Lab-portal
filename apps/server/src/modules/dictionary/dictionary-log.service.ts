import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { EnvConfig } from '../../config/env.validation';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface LookupLogEntry {
  stationId: string | null;
  word: string;
  resolvedHeadword: string | null;
  found: boolean;
}

export interface TopWordRow {
  word: string;
  count: number;
}

/**
 * Lookup telemetry (spec §8, optional-but-built): "words your class looked
 * up most this week" and the one-click item-bank export it feeds. Kept as
 * its own service (not inline in DictionaryService) so the hot lookup
 * path's only coupling to it is one fire-and-forget call — a logging
 * failure must never fail or slow down a lookup (spec C3, <50ms).
 *
 * Scope note: rows record `stationId` only, not `studentId`/`sessionId` —
 * resolving those would mean an extra DB round trip on every lookup for a
 * report-only field the top-words aggregate doesn't need. A drill-down by
 * student is a real follow-up, not implemented here.
 */
@Injectable()
export class DictionaryLogService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  onModuleInit(): void {
    void this.purgeExpired();
    // unref() so this interval never keeps the process alive on its own
    // (matters for a clean `npm run test`/CLI shutdown).
    setInterval(() => void this.purgeExpired(), ONE_DAY_MS).unref();
  }

  /** Fire-and-forget — callers never await this. */
  logLookup(entry: LookupLogEntry): void {
    this.prisma.dictionaryLookup
      .create({ data: entry })
      .catch((err: unknown) => this.logger.warn(`Failed to record a dictionary lookup: ${err instanceof Error ? err.message : err}`));
  }

  async purgeExpired(): Promise<number> {
    const days = this.config.get('DICTIONARY_LOG_RETENTION_DAYS', { infer: true });
    const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
    const result = await this.prisma.dictionaryLookup.deleteMany({ where: { at: { lt: cutoff } } });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} dictionary lookup log row(s) older than ${days} day(s)`);
    }
    return result.count;
  }

  /** Admin-triggered purge-everything (spec §8: "let an admin purge it"). */
  async purgeAll(): Promise<number> {
    const result = await this.prisma.dictionaryLookup.deleteMany({});
    return result.count;
  }

  /** "Words your class looked up most this week" — grouped on the
   * RESOLVED headword (not the raw query text), so "runs"/"running"/"ran"
   * all count toward the one word "run" a teacher would actually add to a
   * word list. A lookup that resolved to nothing is excluded — there is no
   * headword to group it under or to export. */
  async topWords(days: number, limit: number): Promise<TopWordRow[]> {
    const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
    const rows = await this.prisma.dictionaryLookup.groupBy({
      by: ['resolvedHeadword'],
      where: { at: { gte: cutoff }, found: true, resolvedHeadword: { not: null } },
      _count: { resolvedHeadword: true },
      orderBy: { _count: { resolvedHeadword: 'desc' } },
      take: limit,
    });
    return rows
      .filter((r): r is typeof r & { resolvedHeadword: string } => r.resolvedHeadword !== null)
      .map((r) => ({ word: r.resolvedHeadword, count: r._count.resolvedHeadword }));
  }
}
