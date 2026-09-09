import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  UserRole,
  zClaimStationDto,
  zStationAssignSeatDto,
  zStationRegisterDto,
  type ClaimStationDto,
  type StationAssignSeatDto,
  type StationRegisterDto,
} from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentStation } from '../../common/decorators/current-station.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { StationsService } from './stations.service';

@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  /**
   * Public: a freshly-imaged station has no credentials yet. Registration
   * itself is harmless (it only ever creates an UNCLAIMED row); the
   * station gains no capability until an admin assigns it a seat.
   */
  @Public()
  @Post('register')
  async register(@Body(new ZodValidationPipe(zStationRegisterDto)) dto: StationRegisterDto) {
    return this.stations.register(dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('assign-seat')
  async assignSeat(
    @Body(new ZodValidationPipe(zStationAssignSeatDto)) dto: StationAssignSeatDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.stations.assignSeat(dto, user.sub);
    return { ok: true };
  }

  @Roles(UserRole.ADMIN)
  @Post('swap-seats/:a/:b')
  async swapSeats(@Param('a') a: string, @Param('b') b: string, @CurrentUser() user: JwtPayload) {
    await this.stations.swapSeats(a, b, user.sub);
    return { ok: true };
  }

  /** Roster pick, not a login — see StationsService.claim's doc comment.
   * @Roles() empty overrides the (absent, here) class-level restriction;
   * StationAuthGuard is what actually enforces "caller is a station".
   * Phase 5 hardening: this route takes a serviceNumber and NO password
   * at all (deliberately — see the doc comment below), which makes it
   * the one place on the server where guessing a valid identifier alone
   * has any effect; throttled tighter than login for exactly that reason. */
  @Roles()
  @UseGuards(StationAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('claim')
  async claim(
    @Body(new ZodValidationPipe(zClaimStationDto)) dto: ClaimStationDto,
    @CurrentStation() station: { id: string },
  ) {
    const { userId, fullName } = await this.stations.claim(station.id, dto.serviceNumber);
    return { ok: true, userId, fullName };
  }

  @Roles()
  @UseGuards(StationAuthGuard)
  @Post('release')
  async release(@CurrentStation() station: { id: string }) {
    await this.stations.release(station.id);
    return { ok: true };
  }

  /** Dashboard-side counterpart to the station's own self-release above —
   * lets an admin/teacher free a seat that claimed the wrong student (or
   * whose occupant left without releasing) without touching that PC. */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post(':id/release-student')
  async releaseStudent(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.stations.release(id, user.sub);
    return { ok: true };
  }

  // GET status-board lives on ControlController (/api/control/status-board),
  // not here — it needs live PresenceService data merged in (lock, mic,
  // online lifecycle), and PresenceService lives in ControlModule, which
  // already imports StationsModule. Adding the reverse import here would
  // create a module cycle; see ControlController.statusBoard() for the
  // real implementation and the bug this replaced.
}
