import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  UserRole,
  zStartCourseActivityDto,
  zSubmitCourseActivityDto,
  type StartCourseActivityDto,
  type SubmitCourseActivityDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStation } from '../../common/decorators/current-station.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StationsService } from '../stations/stations.service';
import { EnglishCourseService } from './english-course.service';

/**
 * Seat routes act for the student signed in at the station (same posture
 * as AttemptsController) — the course is self-study, so no live session or
 * teacher is needed (Ser 1 "self-study even when teacher not present").
 */
@Roles()
@UseGuards(StationAuthGuard)
@Controller('english-course')
export class EnglishCourseController {
  constructor(
    private readonly course: EnglishCourseService,
    private readonly stations: StationsService,
  ) {}

  @Get('catalog')
  async catalog(@CurrentStation() station: { id: string }) {
    const found = await this.stations.findById(station.id);
    return this.course.catalog(found.currentUserId ?? null);
  }

  @Post('activities/:key/start')
  async start(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(zStartCourseActivityDto)) dto: StartCourseActivityDto,
    @CurrentStation() station: { id: string },
  ) {
    return this.course.start(await this.requireStudent(station.id), key, dto);
  }

  @Post('attempts/:id/submit')
  async submit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zSubmitCourseActivityDto)) dto: SubmitCourseActivityDto,
    @CurrentStation() station: { id: string },
  ) {
    return this.course.submit(await this.requireStudent(station.id), id, dto);
  }

  @Get('attempts/:id/result')
  async result(@Param('id') id: string, @CurrentStation() station: { id: string }) {
    return this.course.result(id, { studentId: await this.requireStudent(station.id) });
  }

  @Get('progress')
  async progress(@CurrentStation() station: { id: string }) {
    return this.course.progress(await this.requireStudent(station.id));
  }

  private async requireStudent(stationId: string): Promise<string> {
    const station = await this.stations.findById(stationId);
    if (!station.currentUserId) throw new BadRequestException('No student is signed in at this station');
    return station.currentUserId;
  }
}

/** Teacher/admin: browse the catalog (to build a course), preview any
 * activity with its answers, and follow any student's progress. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('english-course/staff')
export class EnglishCourseStaffController {
  constructor(private readonly course: EnglishCourseService) {}

  @Get('catalog')
  catalog() {
    return this.course.catalog(null);
  }

  @Get('activities/:key')
  preview(@Param('key') key: string) {
    return this.course.preview(key);
  }

  @Get('students/:id/progress')
  studentProgress(@Param('id') id: string) {
    return this.course.studentProgress(id);
  }

  @Get('attempts/:id/result')
  result(@Param('id') id: string) {
    return this.course.result(id, {});
  }
}
