import { Controller, Post } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';

@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Post('backup')
  async backup(@CurrentUser() user: JwtPayload) {
    const result = await this.admin.runBackup();
    await this.audit.log({ actorId: user.sub, action: 'admin.backup' });
    return { ok: true, ...result };
  }
}
