import { BadRequestException, Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { UserRole, zExportDictionaryWordsDto, type ExportDictionaryWordsDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { DictionaryLogService, type TopWordRow } from './dictionary-log.service';
import { DictionaryExportService } from './dictionary-export.service';

/**
 * Teacher-facing side of spec §8: a report and the one-click export it
 * feeds. Split from DictionaryController (which stays "any signed-in
 * user, no role check") because every route here is staff-only.
 */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('dictionary/reports')
export class DictionaryReportsController {
  constructor(
    private readonly log: DictionaryLogService,
    private readonly exportService: DictionaryExportService,
  ) {}

  /** "Words your class looked up most this week" (spec §8). Deliberately
   * NOT batch-scoped — see zExportDictionaryWordsDto's own comment on why
   * DictionaryLookup, like Assignment/Attempt, stays unscoped. */
  @Get('top-words')
  topWords(@Query('days') daysRaw?: string, @Query('limit') limitRaw?: string): Promise<TopWordRow[]> {
    const days = clampInt(daysRaw, 7, 1, 90);
    const limit = clampInt(limitRaw, 50, 1, 200);
    return this.log.topWords(days, limit);
  }

  @Post('export-to-item-bank')
  exportToItemBank(
    @Body(new ZodValidationPipe(zExportDictionaryWordsDto)) dto: ExportDictionaryWordsDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exerciseId: string; itemCount: number }> {
    return this.exportService.exportToItemBank(user.sub, dto.title, dto.words);
  }

  /** Admin-triggered purge-everything (spec §8: "let an admin purge it").
   * The daily retention sweep (DictionaryLogService.onModuleInit) already
   * ages rows out on its own; this is for "clear it now". */
  @Roles(UserRole.ADMIN)
  @Delete('logs')
  async purgeLogs(): Promise<{ purged: number }> {
    return { purged: await this.log.purgeAll() };
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) {
    throw new BadRequestException(`Expected a value between ${min} and ${max}`);
  }
  return n;
}
