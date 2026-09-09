import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole, zCreateStudyModuleDto, zUpdateStudyModuleDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StationAuthGuard } from '../../common/guards/station-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { StudyModulesService } from './study-modules.service';

/**
 * Authoring is teacher/admin (Ser 1 "content management library"); the
 * one student-facing route (`GET /study-modules/library`) is
 * station-authenticated, not role-gated — matching Ser 1's "self-study
 * even when teacher not present": a student seat browsing the library
 * needs no live session, no claimed roster identity, and no dashboard
 * login, only its own station token from station:hello (Phase 3).
 */
@Controller('study-modules')
export class StudyModulesController {
  constructor(private readonly modules: StudyModulesService) {}

  @Roles()
  @UseGuards(StationAuthGuard)
  @Get('library')
  async library() {
    return this.modules.library();
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post()
  async create(@Body(new ZodValidationPipe(zCreateStudyModuleDto)) dto: ReturnType<typeof zCreateStudyModuleDto.parse>, @CurrentUser() user: JwtPayload) {
    return this.modules.create(dto, user.sub);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get()
  async list() {
    return this.modules.list();
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.modules.get(id);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateStudyModuleDto)) dto: ReturnType<typeof zUpdateStudyModuleDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.modules.update(id, dto, user.sub);
  }

  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.modules.remove(id, user.sub);
    return { ok: true };
  }
}
