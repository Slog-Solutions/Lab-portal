import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_TRANSLATION_SETTINGS,
  isKnownTranslationLanguage,
  zTranslationSettingsDto,
  type TranslationSettings,
} from '@lab/shared';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';

/** AppSetting key holding TranslationSettings. */
export const TRANSLATION_SETTING_KEY = 'translation';

/** How long a read is served from memory before re-reading Postgres.
 * Settings change a few times a year; the reconciler reads them every
 * few seconds and every station snapshot reads them too. */
const CACHE_TTL_MS = 5_000;

/**
 * Admin-owned translation settings, stored as one AppSetting row.
 *
 * Reads NEVER fail: a missing row, a row written by an older build, or a
 * row corrupted by hand all fall back to DEFAULT_TRANSLATION_SETTINGS
 * with a warning. This sits behind every station snapshot — the same
 * reasoning as MediaService.ensureRoom swallowing LiveKit errors: an
 * operator's bad settings row must degrade translation, not the control
 * plane.
 */
@Injectable()
export class TranslationSettingsService {
  private readonly logger = new Logger(TranslationSettingsService.name);
  private cache: { value: TranslationSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<TranslationSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    let value = DEFAULT_TRANSLATION_SETTINGS;
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: TRANSLATION_SETTING_KEY } });
      if (row) {
        const parsed = zTranslationSettingsDto.safeParse(row.value);
        if (parsed.success) {
          value = parsed.data;
        } else {
          this.logger.warn(`AppSetting['${TRANSLATION_SETTING_KEY}'] is invalid — using defaults: ${parsed.error.message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to read translation settings — using defaults: ${(err as Error).message}`);
    }
    this.cache = { value, at: Date.now() };
    return value;
  }

  async set(settings: TranslationSettings, updatedById: string): Promise<TranslationSettings> {
    // Drop codes the catalog doesn't know rather than rejecting the whole
    // save: the catalog can shrink across builds, and an admin editing
    // maxStreams should not be blocked by a stale code they never touched.
    const enabledLanguages = settings.enabledLanguages.filter((code) => {
      if (isKnownTranslationLanguage(code)) return true;
      this.logger.warn(`Ignoring unknown translation language '${code}'`);
      return false;
    });
    const value: TranslationSettings = {
      ...settings,
      enabledLanguages: enabledLanguages.length > 0 ? enabledLanguages : [...DEFAULT_TRANSLATION_SETTINGS.enabledLanguages],
    };
    // Cast at the Prisma boundary only: TranslationSettings is a closed
    // interface, so it has no index signature for InputJsonObject, but it
    // is plain JSON-safe data by construction (zod-parsed above).
    const json = value as unknown as Prisma.InputJsonObject;
    await this.prisma.appSetting.upsert({
      where: { key: TRANSLATION_SETTING_KEY },
      create: { key: TRANSLATION_SETTING_KEY, value: json, updatedById },
      update: { value: json, updatedById },
    });
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** Codes an admin has enabled, in catalog order, always including the
   * class's spoken language — a student must be able to choose "no
   * translation" even if an admin disabled that language as a TARGET. */
  async enabledLanguagesFor(spokenLang: string): Promise<string[]> {
    const { enabledLanguages } = await this.get();
    return enabledLanguages.includes(spokenLang) ? enabledLanguages : [spokenLang, ...enabledLanguages];
  }
}
