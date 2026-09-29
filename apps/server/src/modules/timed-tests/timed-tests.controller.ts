import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole, zExtendTestDto, zLaunchTestDto, type ExtendTestDto, type LaunchTestDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { TimedTestsService } from './timed-tests.service';

/** SPEC-mcq-test-timed-reveal.md §6.1/§6.5. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('activity-instances')
export class TimedTestsController {
  constructor(private readonly timedTests: TimedTestsService) {}

  @Post('launch')
  async launch(@Body(new ZodValidationPipe(zLaunchTestDto)) dto: LaunchTestDto, @CurrentUser() user: JwtPayload) {
    return this.timedTests.launch(user, dto);
  }

  @Get(':id/board')
  async board(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.timedTests.board(user, id);
  }

  @Post(':id/reveal-now')
  async revealNow(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.timedTests.revealNow(user, id);
  }

  @Post(':id/extend')
  async extend(@Param('id') id: string, @Body(new ZodValidationPipe(zExtendTestDto)) dto: ExtendTestDto, @CurrentUser() user: JwtPayload) {
    return this.timedTests.extend(user, id, dto.seconds);
  }

  @Post(':id/close')
  async close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.timedTests.closeWithoutReveal(user, id);
  }

  @Post(':id/release')
  async release(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.timedTests.release(user, id);
  }
}
