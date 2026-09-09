import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Was ADMIN-only; widened to include TEACHER for Phase 3 — the gradebook
 * (assigning exercises to students) and reports both need a student
 * roster, and a read-only user directory isn't a privilege a teacher
 * shouldn't have (they already see every station/session/exercise). */
@Roles(UserRole.ADMIN, UserRole.TEACHER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@Query('role') role?: UserRole) {
    return this.users.list(role);
  }
}
