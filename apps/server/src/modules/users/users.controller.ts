import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  UserRole,
  zCreateUserDto,
  zResetPasswordDto,
  zUpdateUserDto,
  type CreateUserDto,
  type ResetPasswordDto,
  type UpdateUserDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { UsersService } from './users.service';

/** Was ADMIN-only; widened to include TEACHER for Phase 3 — the gradebook
 * (assigning exercises to students) and reports both need a student
 * roster, and a read-only user directory isn't a privilege a teacher
 * shouldn't have (they already see every station/session/exercise).
 *
 * LMS admin core: the write methods below narrow back to ADMIN with a
 * method-level @Roles(UserRole.ADMIN) — RolesGuard uses
 * getAllAndOverride([handler, class]), so the method-level decorator wins
 * over this class-level one. Without it a TEACHER could register users. */
@Roles(UserRole.ADMIN, UserRole.TEACHER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@Query('role') role?: UserRole) {
    return this.users.list(role);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body(new ZodValidationPipe(zCreateUserDto)) dto: CreateUserDto, @CurrentUser() user: JwtPayload) {
    return this.users.createUser(dto, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(zUpdateUserDto)) dto: UpdateUserDto, @CurrentUser() user: JwtPayload) {
    return this.users.update(id, dto, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zResetPasswordDto)) dto: ResetPasswordDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.users.resetPassword(id, dto.password, user.sub);
  }
}
