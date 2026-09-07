import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole, zCreateSessionDto, type CreateSessionDto } from '@lab/shared';
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
    return this.sessions.create(dto, user.sub);
  }

  @Get()
  async list() {
    return this.sessions.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.sessions.get(id);
  }

  @Post(':id/arm')
  async arm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.arm(id, user.sub);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.start(id, user.sub);
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.pause(id, user.sub);
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sessions.end(id, user.sub);
  }
}
