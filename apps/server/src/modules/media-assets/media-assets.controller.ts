import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UserRole, zCreateMediaFolderDto, zUpdateMediaAssetDto, zUploadMediaAssetDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StationOrStaffGuard } from '../../common/guards/station-or-staff.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { streamFileWithRange } from '../../common/http/range-stream';
import type { JwtPayload } from '../auth/auth.service';
import { MediaAssetsService } from './media-assets.service';

/**
 * The media library (Ser 1). Curated (uploaded/edited/deleted) by
 * teachers/admins only — student-produced audio (activity recordings,
 * pronunciation attempts) stays in the separate Recording model;
 * MediaAsset is reference/library content (master tracks, model audio,
 * source texts, images) that exercises and activities point students AT
 * by id.
 *
 * Phase 4 finding: the two READ routes were blanket TEACHER/ADMIN-only
 * (a leftover from this controller's first pass, before any player
 * actually fetched an asset from the student side) — which meant every
 * student-facing consumer of this endpoint (PronunciationPlayer's model
 * audio, and this pass's ModelImitationActivity master track /
 * VocabularyTestPlayer listening-item audio) would 403 for the exact
 * station token those components use, caught live by this pass's own
 * verification script rather than by any of them separately. Fixed the
 * same way RecordingsController already solved the identical shape of
 * problem: StationOrStaffGuard on the read paths only, write paths stay
 * teacher/admin-only. MediaAssetsService.get()'s own scope check
 * (assertReadable) already treats any non-owner identity correctly for
 * DEPARTMENT/INSTITUTION-scope assets — a station is simply never the
 * owner of a PRIVATE one, which is the correct outcome, not a gap.
 */
@Controller('media-assets')
export class MediaAssetsController {
  constructor(private readonly assets: MediaAssetsService) {}

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(zUploadMediaAssetDto)) dto: ReturnType<typeof zUploadMediaAssetDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.assets.create({ id: user.sub, role: user.role }, dto, {
      tempPath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
    });
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.assets.list({ id: user.sub, role: user.role });
  }

  // Folder routes are declared before ':id' so 'folders' isn't read as an asset id.
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('folders')
  async listFolders() {
    return this.assets.listFolders();
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('folders')
  async createFolder(
    @Body(new ZodValidationPipe(zCreateMediaFolderDto)) dto: ReturnType<typeof zCreateMediaFolderDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assets.createFolder({ id: user.sub, role: user.role }, dto);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Delete('folders/:id')
  async removeFolder(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assets.removeFolder(id, { id: user.sub, role: user.role });
    return { ok: true };
  }

  @Roles()
  @UseGuards(StationOrStaffGuard)
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.assets.get(id, { id: user.sub, role: user.role });
  }

  @Roles()
  @UseGuards(StationOrStaffGuard)
  @Get(':id/file')
  async streamFile(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.assets.get(id, { id: user.sub, role: user.role });
    streamFileWithRange(req, res, this.assets.resolveFilePath(asset), asset.mimeType);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateMediaAssetDto)) dto: ReturnType<typeof zUpdateMediaAssetDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assets.update(id, dto, { id: user.sub, role: user.role });
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assets.remove(id, { id: user.sub, role: user.role });
    return { ok: true };
  }
}
