import { Injectable } from '@nestjs/common';
import type { UserRole } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(params: {
    serviceNumber: string;
    fullName: string;
    role: UserRole;
    password: string;
    rank?: string;
  }) {
    const passwordHash = await AuthService.hashPassword(params.password);
    return this.prisma.user.create({
      data: {
        serviceNumber: params.serviceNumber,
        fullName: params.fullName,
        role: params.role,
        rank: params.rank,
        passwordHash,
      },
    });
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
}
