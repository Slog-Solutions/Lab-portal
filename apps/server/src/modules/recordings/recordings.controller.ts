import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { RecordingKind } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStation } from '../../common/decorators/current-station.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import { StationOrStaffGuard } from '../../common/guards/station-or-staff.guard';
import { streamFileWithRange } from '../../common/http/range-stream';
import { RecordingsService } from './recordings.service';

const zCreateRecordingDto = z.object({
  kind: z.enum([
    RecordingKind.MODEL_IMITATION,
    RecordingKind.GROUP_DISCUSSION,
    RecordingKind.PRESENTATION,
    RecordingKind.INTERPRETATION,
    RecordingKind.PRONUNCIATION,
  ]),
  sessionId: z.string().optional(),
  activityInstanceId: z.string().optional(),
  attemptId: z.string().optional(),
  stationId: z.string().optional(),
  studentIds: z.array(z.string()).optional(),
});

/**
 * Every Phase 2 (and now pronunciation) activity's recording flows
 * through here (design doc §2.6). Phase 3 closes the auth gap this
 * controller used to carry: stations now hold a real credential (see
 * auth.service.ts's mintStationToken), so create/upload are
 * station-only, and read/stream accept either the recording's own
 * station or TEACHER/ADMIN (gradebook review) — see StationAuthGuard/
 * StationOrStaffGuard. This was the same tracked gap the compliance
 * matrix flagged since Phase 1/2, not a new one.
 */
@Roles()
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @UseGuards(StationAuthGuard)
  @Post()
  async create(
    @Body(new ZodValidationPipe(zCreateRecordingDto)) dto: z.infer<typeof zCreateRecordingDto>,
    @CurrentStation() station: { id: string },
  ) {
    // A station may only ever record as itself — without this, any
    // station could attribute a recording to a stationId it doesn't own.
    if (dto.stationId && dto.stationId !== station.id) {
      throw new BadRequestException('stationId must match the authenticated station');
    }
    return this.recordings.createPending({ ...dto, stationId: dto.stationId ?? station.id });
  }

  @UseGuards(StationOrStaffGuard)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.recordings.get(id);
  }

  @UseGuards(StationOrStaffGuard)
  @Get()
  async listForActivity(@Query('activityInstanceId') activityInstanceId: string) {
    if (!activityInstanceId) return [];
    return this.recordings.listForActivity(activityInstanceId);
  }

  @UseGuards(StationAuthGuard)
  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('durationMs') durationMs?: string,
  ) {
    if (!file) throw new NotFoundException('No file uploaded');
    return this.recordings.finalizeUpload(id, file.path, file.originalname, durationMs ? Number(durationMs) : undefined);
  }

  @UseGuards(StationOrStaffGuard)
  @Get(':id/file')
  async streamFile(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const recording = await this.recordings.get(id);
    const filePath = this.recordings.resolveFilePath(recording);
    streamFileWithRange(req, res, filePath, 'application/octet-stream');
  }
}
