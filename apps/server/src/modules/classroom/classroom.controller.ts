import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole, zClaimStationDto, zStartClassDto, type ClaimStationDto, type StartClassDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentStation } from '../../common/decorators/current-station.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { ClassAccessService } from './class-access.service';
import { ClassroomService } from './classroom.service';

@Controller('classroom')
export class ClassroomController {
  constructor(
    private readonly classroom: ClassroomService,
    private readonly classAccess: ClassAccessService,
  ) {}

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('start')
  async start(@Body(new ZodValidationPipe(zStartClassDto)) dto: StartClassDto, @CurrentUser() user: JwtPayload) {
    return this.classroom.start(user, dto);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('current')
  async current(@CurrentUser() user: JwtPayload) {
    return this.classroom.current(user);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.classroom.end(id, user);
  }

  /** A real student login at a seat — see StationsService.claim's doc
   * comment. @Roles() empty overrides the (absent, here) class-level
   * restriction; StationAuthGuard is what actually enforces "caller is a
   * station" (the student's own credential is checked inside the
   * service). Throttled the same as POST /auth/login — a wrong guess here
   * has a persistent side effect (an audit trail entry), same reasoning as
   * BatchesController's join route. */
  @Roles()
  @UseGuards(StationAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sign-in')
  async signIn(@Body(new ZodValidationPipe(zClaimStationDto)) dto: ClaimStationDto, @CurrentStation() station: { id: string }) {
    return this.classroom.signIn(station.id, dto);
  }

  @Roles()
  @UseGuards(StationAuthGuard)
  @Post('sign-out')
  async signOut(@CurrentStation() station: { id: string }) {
    return this.classroom.signOut(station.id);
  }

  /** Dashboard-side counterpart to sign-out above — lets a teacher/admin
   * free a seat without touching that PC. Scoped to the calling teacher's
   * own class (assertCanControlStation); ADMIN can release anyone. */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post('stations/:stationId/release-student')
  async releaseStudent(@Param('stationId') stationId: string, @CurrentUser() user: JwtPayload) {
    await this.classAccess.assertCanControlStation(user, stationId);
    return this.classroom.releaseStudent(stationId, user);
  }
}
