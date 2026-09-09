import { Body, Controller, Get, Post } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AssetKind, MediaAssetScope, UserRole } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StorageService } from '../../common/storage/storage.service';
import type { JwtPayload } from '../auth/auth.service';
import { MediaAssetsService } from '../media-assets/media-assets.service';
import { PronunciationService } from './pronunciation.service';

const zGenerateDto = z.object({
  sourceText: z.string().min(1).max(2000),
  voice: z.enum(['en_US', 'en_GB']).default('en_GB'),
});

/** Exercise-authoring helper for Ser 7 — generates IPA + model audio for
 * a teacher's source text and files both into the media library, ready
 * to drop straight into a PRONUNCIATION exercise's ipaAssetId/
 * modelAudioAssetId config fields. Either half can be unavailable (see
 * PronunciationService's doc comment) without failing the whole call. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('pronunciation')
export class PronunciationController {
  constructor(
    private readonly pronunciation: PronunciationService,
    private readonly assets: MediaAssetsService,
    private readonly storage: StorageService,
  ) {}

  @Get('status')
  status() {
    return this.pronunciation.isConfigured();
  }

  @Post('generate')
  async generate(@Body(new ZodValidationPipe(zGenerateDto)) dto: z.infer<typeof zGenerateDto>, @CurrentUser() user: JwtPayload) {
    const result: { ipaAssetId: string | null; modelAudioAssetId: string | null; warnings: string[] } = {
      ipaAssetId: null,
      modelAudioAssetId: null,
      warnings: [],
    };

    try {
      const ipa = await this.pronunciation.generateIpa(dto.sourceText);
      const tempPath = await this.writeTemp(`${ipa}\n`, '.txt');
      const asset = await this.assets.create(
        user.sub,
        { kind: AssetKind.TEXT, title: `IPA: ${dto.sourceText.slice(0, 40)}`, scope: MediaAssetScope.INSTITUTION },
        { tempPath, originalName: 'ipa.txt', mimeType: 'text/plain' },
      );
      result.ipaAssetId = asset.id;
    } catch (err) {
      result.warnings.push((err as Error).message);
    }

    try {
      const wav = await this.pronunciation.generateModelAudio(dto.sourceText, dto.voice);
      const tempPath = await this.writeTempBuffer(wav, '.wav');
      const asset = await this.assets.create(
        user.sub,
        { kind: AssetKind.AUDIO, title: `Model voice: ${dto.sourceText.slice(0, 40)}`, scope: MediaAssetScope.INSTITUTION },
        { tempPath, originalName: 'model.wav', mimeType: 'audio/wav' },
      );
      result.modelAudioAssetId = asset.id;
    } catch (err) {
      result.warnings.push((err as Error).message);
    }

    return result;
  }

  private async writeTemp(content: string, ext: string): Promise<string> {
    return this.writeTempBuffer(Buffer.from(content, 'utf-8'), ext);
  }

  private async writeTempBuffer(buf: Buffer, ext: string): Promise<string> {
    const dir = await this.storage.ensureTempDir();
    const filePath = path.join(dir, `pronunciation-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    await writeFile(filePath, buf);
    return filePath;
  }
}
