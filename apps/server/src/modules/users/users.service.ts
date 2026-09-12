import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';

// Same safe shape as list() below, plus createdAt — every write method
// returns this, never the raw Prisma row, so passwordHash can never leak
// into an HTTP response (createUser used to return the raw row; it was
// harmless only because nothing called it yet).
const SAFE_USER_SELECT = {
  id: true,
  serviceNumber: true,
  fullName: true,
  role: true,
  rank: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createUser(
    params: { serviceNumber: string; fullName: string; role: UserRole; password: string; rank?: string },
    actorId?: string,
  ) {
    const passwordHash = await AuthService.hashPassword(params.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          serviceNumber: params.serviceNumber,
          fullName: params.fullName,
          role: params.role,
          rank: params.rank,
          passwordHash,
        },
        select: SAFE_USER_SELECT,
      });
      await this.audit.log({ actorId, action: 'user.create', detail: { userId: user.id, role: user.role, serviceNumber: user.serviceNumber } });
      return user;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Service number already in use');
      }
      throw err;
    }
  }

  async findById(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  async list(role?: UserRole) {
    return this.prisma.user.findMany({
      where: role ? { role } : undefined,
      select: { id: true, serviceNumber: true, fullName: true, role: true, rank: true, active: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async update(id: string, patch: { fullName?: string; rank?: string; active?: boolean }, actorId: string) {
    try {
      const user = await this.prisma.user.update({ where: { id }, data: patch, select: SAFE_USER_SELECT });
      // Deactivation blocks future logins (AuthService.login rejects
      // !user.active) but does NOT revoke an already-issued JWT — this
      // codebase has no token revocation anywhere yet, so that matches
      // the existing posture rather than being a new gap.
      if (patch.active !== undefined) {
        await this.audit.log({ actorId, action: patch.active ? 'user.reactivate' : 'user.deactivate', detail: { userId: id } });
      } else {
        await this.audit.log({ actorId, action: 'user.update', detail: { userId: id, changed: Object.keys(patch) } });
      }
      return user;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw err;
    }
  }

  async resetPassword(id: string, password: string, actorId: string) {
    const passwordHash = await AuthService.hashPassword(password);
    try {
      await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw err;
    }
    // Never log the password itself.
    await this.audit.log({ actorId, action: 'user.password_reset', detail: { userId: id } });
    return { ok: true };
  }
}
