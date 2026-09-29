import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  zSaveDraftAnswersDto,
  zStartAttemptDto,
  zSubmitAttemptDto,
  type SaveDraftAnswersDto,
  type StartAttemptDto,
  type SubmitAttemptDto,
} from '@lab/shared';
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
    return this.attempts.start(studentId, station.id, dto);
  }

  @Put(':id/answers')
  async saveAnswers(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zSaveDraftAnswersDto)) dto: SaveDraftAnswersDto,
    @CurrentStation() station: { id: string },
  ) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.saveDraft(id, studentId, dto);
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

  @Get(':id/result')
  async result(@Param('id') id: string, @CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.getResult(id, studentId);
  }

  @Get('mine')
  async mine(@Query('exerciseId') exerciseId: string | undefined, @CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.listForStudent(studentId, exerciseId);
  }

  @Get('assignments/mine')
  async myAssignments(@CurrentStation() station: { id: string }) {
    const studentId = await this.requireClaimedStudent(station.id);
    return this.attempts.listAssignmentsForStudent(studentId);
  }

  private async requireClaimedStudent(stationId: string): Promise<string> {
    const station = await this.stations.findById(stationId);
    if (!station.currentUserId) {
      throw new BadRequestException('No student is signed in at this station');
    }
    return station.currentUserId;
  }
}
