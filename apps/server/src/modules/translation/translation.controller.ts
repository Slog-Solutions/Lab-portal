import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  TRANSLATION_LANGUAGES,
  UserRole,
  zClassTranslationDto,
  zCreateTranslationTestDto,
  zTranslationSettingsDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { streamFileWithRange } from '../../common/http/range-stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { TranslationService } from './translation.service';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslationTestsService } from './translation-tests.service';
import { TranslatorClient } from './translator.client';

@Controller('translation')
export class TranslationController {
  constructor(
    private readonly translation: TranslationService,
    private readonly settings: TranslationSettingsService,
    private readonly tests: TranslationTestsService,
    private readonly translator: TranslatorClient,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The full catalog plus which codes are enabled — one call, so the UI
   * can render disabled options without a second request. */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('languages')
  async languages() {
    const settings = await this.settings.get();
    return {
      configured: this.translator.configured,
      enabled: settings.enabledLanguages,
      catalog: TRANSLATION_LANGUAGES,
    };
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('health')
  async health() {
    return { configured: this.translator.configured, engine: await this.translator.health() };
  }

  @Roles(UserRole.ADMIN)
  @Get('settings')
  async getSettings() {
    return this.settings.get();
  }

  @Roles(UserRole.ADMIN)
  @Put('settings')
  async putSettings(
    @Body(new ZodValidationPipe(zTranslationSettingsDto)) dto: ReturnType<typeof zTranslationSettingsDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    const saved = await this.settings.set(dto, user.sub);
    await this.audit.log({ actorId: user.sub, action: 'translation.settings.update', detail: { ...saved } });
    return saved;
  }

  /** The teacher's per-class toggle. */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Put('classes/:classId')
  async setClassTranslation(
    @Param('classId') classId: string,
    @Body(new ZodValidationPipe(zClassTranslationDto)) dto: ReturnType<typeof zClassTranslationDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOwnsClass(classId, user);
    if (dto.enabled && !this.translator.configured) {
      throw new BadRequestException('Translation is not configured on this server');
    }
    const result = await this.translation.setClassTranslation(classId, dto.enabled, dto.spokenLanguage);
    await this.audit.log({
      actorId: user.sub,
      action: dto.enabled ? 'translation.class.enable' : 'translation.class.disable',
      detail: { classId, ...result },
    });
    return result;
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('classes/:classId/status')
  async classStatus(@Param('classId') classId: string, @CurrentUser() user: JwtPayload) {
    await this.assertOwnsClass(classId, user);
    return this.translation.statusFor(classId);
  }

  // ---- Translation Lab ----------------------------------------------------

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('test-runs')
  @UseInterceptors(FileInterceptor('file'))
  async createTestRun(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(zCreateTranslationTestDto)) dto: ReturnType<typeof zCreateTranslationTestDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No audio file uploaded');
    return this.tests.create(user, dto, {
      tempPath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
    });
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('test-runs')
  async listTestRuns(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.tests.list(user, Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('test-runs/:runId')
  async getTestRun(@Param('runId') runId: string, @CurrentUser() user: JwtPayload) {
    return this.tests.get(user, runId);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Delete('test-runs/:runId')
  async deleteTestRun(@Param('runId') runId: string, @CurrentUser() user: JwtPayload) {
    return this.tests.remove(user, runId);
  }

  /** Range-streamed so the browser's own <audio> seek bar works on a long
   * output, same as every other audio read in this codebase. */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('test-runs/:runId/files/:fileName')
  async getTestRunFile(
    @Param('runId') runId: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const absolutePath = await this.tests.outputPath(user, runId, fileName);
    const mime = fileName.endsWith('.wav')
      ? 'audio/wav'
      : fileName.endsWith('.json')
        ? 'application/json'
        : fileName.endsWith('.txt')
          ? 'text/plain; charset=utf-8'
          : 'application/octet-stream';
    streamFileWithRange(req, res, absolutePath, mime);
  }

  /** The owning teacher, or any ADMIN — the same rule
   * ClassroomService.end applies, kept consistent so "my class" means the
   * same thing on every classroom-scoped endpoint. */
  private async assertOwnsClass(classId: string, user: JwtPayload): Promise<void> {
    const liveClass = await this.prisma.liveClass.findUnique({ where: { id: classId }, select: { teacherId: true } });
    if (!liveClass) throw new NotFoundException('Class not found');
    if (user.role !== UserRole.ADMIN && liveClass.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your class');
    }
  }
}
