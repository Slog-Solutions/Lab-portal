import { Controller, Get, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  zDictionaryLookupQuery,
  zDictionarySearchQuery,
  zDictionarySuggestQuery,
  type DictionaryLookupQuery,
  type DictionaryLookupResult,
  type DictionaryMeta,
  type DictionarySearchQuery,
  type DictionarySuggestQuery,
} from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { DictionaryAccessGuard } from './dictionary-access.guard';
import { DictionaryService } from './dictionary.service';
import { DictionaryLogService } from './dictionary-log.service';

/**
 * Read-only dictionary lookup surface (spec §5). No class-level @Roles —
 * "Any signed-in user" (station or human) may call every route here;
 * DictionaryAccessGuard is the per-activity teacher control (spec §7),
 * not a role check, and deliberately sits only on the three data routes
 * below — `meta` stays reachable even from a station whose activity has
 * the dictionary turned off, since the About screen still needs to render.
 */
@Controller('dictionary')
export class DictionaryController {
  constructor(
    private readonly dictionary: DictionaryService,
    private readonly log: DictionaryLogService,
  ) {}

  /** Version, sources, licence mode, attribution — always 200, even when
   * the dictionary itself is unavailable (spec §5's own "must start
   * anyway" posture extends to this route: the About screen needs
   * something to render either way). */
  @Get('meta')
  meta(): DictionaryMeta {
    return this.dictionary.meta();
  }

  @UseGuards(DictionaryAccessGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('lookup')
  lookup(
    @Query(new ZodValidationPipe(zDictionaryLookupQuery)) query: DictionaryLookupQuery,
    @CurrentUser() user: JwtPayload,
  ): DictionaryLookupResult {
    this.assertAvailable();
    const result = this.dictionary.lookup(query.q);
    // Fire-and-forget (spec §8) — never on the response's critical path.
    this.log.logLookup({
      stationId: user.kind === 'station' ? user.sub : null,
      word: result.query,
      resolvedHeadword: result.headword,
      found: result.found,
    });
    return result;
  }

  /** 180/min — a 150ms-debounced type-ahead (spec §6.2) still needs
   * meaningfully more headroom than a deliberate lookup submission. */
  @UseGuards(DictionaryAccessGuard)
  @Throttle({ default: { limit: 180, ttl: 60_000 } })
  @Get('suggest')
  suggest(@Query(new ZodValidationPipe(zDictionarySuggestQuery)) query: DictionarySuggestQuery): string[] {
    this.assertAvailable();
    return this.dictionary.suggest(query.q, query.limit);
  }

  @UseGuards(DictionaryAccessGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  search(@Query(new ZodValidationPipe(zDictionarySearchQuery)) query: DictionarySearchQuery): string[] {
    this.assertAvailable();
    return this.dictionary.search(query.q, query.limit);
  }

  private assertAvailable(): void {
    if (!this.dictionary.isAvailable()) {
      throw new ServiceUnavailableException({ message: 'Dictionary unavailable', code: 'DICTIONARY_UNAVAILABLE' });
    }
  }
}
