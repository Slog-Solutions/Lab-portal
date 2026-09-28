import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { UserRole, zRoundTableStationDto, type RoundTableStationDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { RoundTableService } from './round-table.service';

/**
 * Teacher-side Round Table controls (Ser 3: "the teacher can listen in on
 * each group and participate when needed"). Every route checks the caller
 * teaches this session's batch — the same boundary SessionsService uses —
 * before touching the floor or minting a token.
 */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('sessions/:sessionId')
export class RoundTableController {
  constructor(private readonly roundTable: RoundTableService) {}

  @Get('round-table')
  overview(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string) {
    return this.roundTable.overview(user, sessionId);
  }

  @Get('groups/:groupId/round-table/review')
  review(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    return this.roundTable.review(user, sessionId, groupId);
  }

  /** Subscribe-only; students see "Teacher is listening". */
  @Post('groups/:groupId/round-table/listen')
  @HttpCode(200)
  listen(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    return this.roundTable.listen(user, sessionId, groupId);
  }

  /** Same room, mic allowed; students see "Teacher has joined". */
  @Post('groups/:groupId/round-table/participate')
  @HttpCode(200)
  participate(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    return this.roundTable.participate(user, sessionId, groupId);
  }

  @Post('groups/:groupId/round-table/leave')
  @HttpCode(204)
  async leave(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    await this.roundTable.leave(user, sessionId, groupId);
  }

  @Post('groups/:groupId/round-table/grant')
  @HttpCode(204)
  async grant(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(zRoundTableStationDto)) dto: RoundTableStationDto,
  ) {
    await this.roundTable.teacherGrant(user, sessionId, groupId, dto.stationId);
  }

  @Post('groups/:groupId/round-table/revoke')
  @HttpCode(204)
  async revoke(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    await this.roundTable.teacherRevoke(user, sessionId, groupId);
  }

  @Post('groups/:groupId/round-table/chairman')
  @HttpCode(204)
  async chairman(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(zRoundTableStationDto)) dto: RoundTableStationDto,
  ) {
    await this.roundTable.setChairman(user, sessionId, groupId, dto.stationId);
  }

  @Post('groups/:groupId/round-table/mute-all')
  @HttpCode(204)
  async muteAll(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string, @Param('groupId') groupId: string) {
    await this.roundTable.muteAll(user, sessionId, groupId);
  }
}
