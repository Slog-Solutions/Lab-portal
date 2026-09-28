import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole, zCreateSessionDto, zSetGroupDictionaryDto, type CreateSessionDto, type SetGroupDictionaryDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { SessionsService } from './sessions.service';

@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  async create(@Body(new ZodValidationPipe(zCreateSessionDto)) dto: CreateSessionDto, @CurrentUser() user: JwtPayload) {
    return this.sessions.create(dto, user);
  }

  /** `?batchId=` lists one class's sessions (its own activity screen). */
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query('batchId') batchId?: string) {
    return this.sessions.list(user, batchId || undefined);
  }

  // MUST be declared before ':id' — Nest/Express matches routes in
  // declaration order, so a literal segment after a param route would
  // be shadowed (a request for /sessions/batches would otherwise bind
  // to :id = "batches"). Delegates to BatchesService.listForPrincipal,
  // the same source as GET /batches/mine — one authority for who may
  // use which batch (enforced teacher<->batch assignment).
  @Get('batches')
  async listBatches(@CurrentUser() user: JwtPayload) {
    return this.sessions.listBatches(user);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.sessions.get(id);
  }

  @Post(':id/arm')
  async arm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.arm(id, user);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.start(id, user);
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.pause(id, user);
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.end(id, user);
  }

  /** Teacher control (spec §7) — per-group dictionary on/off, live. */
  @Patch(':id/groups/:groupId/dictionary')
  async setGroupDictionary(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(zSetGroupDictionaryDto)) dto: SetGroupDictionaryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessions.setGroupDictionary(id, groupId, dto.enabled, user);
  }
}
