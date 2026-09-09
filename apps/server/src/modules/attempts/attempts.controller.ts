import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { zStartAttemptDto, zSubmitAttemptDto, type StartAttemptDto, type SubmitAttemptDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStation } from '../../common/decorators/current-station.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StationsService } from '../stations/stations.service';
import { AttemptsService } from './attempts.service';

/** A station acts here on behalf of whichever student it has claimed
 * (StationsService.claim) — see attempts.service.ts's doc comment for why
 * this needs a real studentId, unlike classroom-control features. */
@Roles()
@UseGuards(StationAuthGuard)
@Controller('attempts')
export class AttemptsController {
  constructor(
    private readonly attempts: AttemptsService,
    private readonly stations: StationsService,
  ) {}

  @Post('start')
  async start(@Body(new ZodValidationPipe(zStartAttemptDto)) dto: StartAttemptDto, @CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.start(studentId, dto);
  }

  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zSubmitAttemptDto)) dto: SubmitAttemptDto,
    @CurrentStation() station: { id: string },
  ) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.submit(id, studentId, dto);
  }

  @Get('mine')
  async mine(@CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.listForStudent(studentId);
  }

  @Get('assignments/mine')
  async myAssignments(@CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.listAssignmentsForStudent(studentId);
  }

  private async requireClaimedStudent(stationId: string): Promise<string> {
    const station = await this.stations.findById(stationId);
    if (!station.currentUserId) {
      throw new BadRequestException('This station has not claimed a student yet — call POST /stations/claim first');
    }
    return station.currentUserId;
  }
}
