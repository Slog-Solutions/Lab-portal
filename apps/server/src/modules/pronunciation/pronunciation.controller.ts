import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  AssetKind,
  MediaAssetScope,
  UserRole,
  zCreatePronunciationExerciseDto,
  zSpeakDto,
  type CreatePronunciationExerciseDto,
  type SpeakDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StorageService } from '../../common/storage/storage.service';
import { Public } from '../../common/guards/jwt-auth.guard';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import { StationOrStaffGuard } from '../../common/guards/station-or-staff.guard';
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
@Controller('pronunciation')
export class PronunciationController {
  constructor(
    private readonly pronunciation: PronunciationService,
    private readonly assets: MediaAssetsService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('status')
  status() {
    return this.pronunciation.isConfigured();
  }

  /** On-demand model voice + IPA — student word practice, a test's "hear
   * the word" button, a teacher playing the model back while grading, and
   * a PRONUNCIATION exercise's "Listen to pronunciation" button when the
   * exercise has no pre-generated modelAudioAssetId (see zSpeakDto — this
   * takes a whole sentence/paragraph, not just a word). Station OR staff,
   * the same read-path posture as RecordingsController (see
   * StationOrStaffGuard); results are cached server-side per text/voice, so
   * a whole class asking at once costs one synthesis run. */
  @Roles()
  @UseGuards(StationOrStaffGuard)
  @HttpCode(HttpStatus.OK) // computes a result, creates nothing — not a 201
  @Post('speak')
  speak(@Body(new ZodValidationPipe(zSpeakDto)) dto: SpeakDto) {
    return this.pronunciation.speak(dto.text, dto.voice);
  }

  /** Open catalogue of PRONUNCIATION exercises a student seat may
   * practise without an assignment. */
  @Roles()
  @UseGuards(StationAuthGuard)
  @Get('practice-exercises')
  practiceExercises() {
    return this.pronunciation.listPracticeExercises();
  }

  /** The teacher's "Your Pronunciation Exercises" table — every
   * PRONUNCIATION exercise with its assignment/submission counts, so the
   * page can show who has it and who has answered without a second
   * round trip per row. */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('exercises')
  exercises() {
    return this.pronunciation.listExercisesForTeacher();
  }

  /** The simple one-step authoring form: a sentence/paragraph/word, the
   * students, and a due date — creates the exercise and assigns it in one
   * call, no pipeline round trip required first (see
   * PronunciationService.createExercise's doc comment). */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('exercises')
  createExercise(
    @Body(new ZodValidationPipe(zCreatePronunciationExerciseDto)) dto: CreatePronunciationExerciseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pronunciation.createExercise(user, dto);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
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
        { id: user.sub, role: user.role },
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
        { id: user.sub, role: user.role },
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
