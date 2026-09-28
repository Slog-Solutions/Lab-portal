import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UserRole, zFinishClassRecordingDto, zStartClassRecordingDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { streamFileWithRange } from '../../common/http/range-stream';
import { ClassRecordingsService } from './class-recordings.service';

/**
 * Teacher/admin recording of their own class broadcast (BroadcastPanel's
 * Record button) — a separate controller from RecordingsController's
 * station-only routes, because a teacher's dashboard session has a user
 * JWT, never a station credential (see that controller's own doc
 * comment on the same split for the read paths). Every route is scoped
 * to the caller's own recordings (ClassRecordingsService.getOwned), an
 * ADMIN excepted.
 */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('class-recordings')
export class ClassRecordingsController {
  constructor(
    private readonly recordings: ClassRecordingsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async start(
    @Body(new ZodValidationPipe(zStartClassRecordingDto)) dto: ReturnType<typeof zStartClassRecordingDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.recordings.create(user, dto.withAudio);
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.recordings.list(user);
  }

  @Post(':id/chunks')
  @UseInterceptors(FileInterceptor('chunk'))
  async appendChunk(
    @Param('id') id: string,
    @Query('seq') seqRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No chunk uploaded');
    const seq = Number(seqRaw);
    if (!Number.isInteger(seq) || seq < 0) throw new BadRequestException('seq must be a non-negative integer');
    return this.recordings.appendChunk(id, user, seq, file.path);
  }

  @Post(':id/finish')
  async finish(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zFinishClassRecordingDto)) dto: ReturnType<typeof zFinishClassRecordingDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.recordings.finish(id, user, dto.durationMs);
  }

  @Get(':id/file')
  async streamFile(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const filePath = await this.recordings.getFilePath(id, user);
    streamFileWithRange(req, res, filePath, 'video/webm');
  }

  /** A student's own read path — @Roles(STUDENT) here overrides the
   * controller's TEACHER/ADMIN default for this one route (NestJS
   * resolves the closest @Roles), the same way GET /batches/:id/
   * my-activity is STUDENT-only while the rest of that controller isn't.
   * Scoped by enrollment, not ownership — see getFilePathForStudent. */
  @Roles(UserRole.STUDENT)
  @Get(':id/student-file')
  async streamFileForStudent(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const filePath = await this.recordings.getFilePathForStudent(id, user.sub);
    streamFileWithRange(req, res, filePath, 'video/webm');
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.recordings.remove(id, user);
    await this.audit.log({ actorId: user.sub, action: 'class_recording.delete', detail: { recordingId: id } });
    return { ok: true };
  }
}
