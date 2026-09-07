import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async list() {
    return this.users.list();
  }
}
