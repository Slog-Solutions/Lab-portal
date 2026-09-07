import { Body, Controller, Param, Post } from '@nestjs/common';
import { UserRole, zStationAssignSeatDto, zStationRegisterDto, type StationAssignSeatDto, type StationRegisterDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  // GET status-board lives on ControlController (/api/control/status-board),
  // not here — it needs live PresenceService data merged in (lock, mic,
  // online lifecycle), and PresenceService lives in ControlModule, which
  // already imports StationsModule. Adding the reverse import here would
  // create a module cycle; see ControlController.statusBoard() for the
  // real implementation and the bug this replaced.
}
