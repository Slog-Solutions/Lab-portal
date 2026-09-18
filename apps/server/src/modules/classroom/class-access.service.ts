import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Single authority for "which stations may this principal see/control"
 * once classroom scoping exists (see build plan "Student self-numbering +
 * classroom code with class-scoped teacher control"). ADMIN bypasses
 * everywhere; a TEACHER may only act on stations currently in their own
 * ACTIVE LiveClass. Deliberately Prisma-only, importing nothing else, so
 * every module that needs this check (ControlModule, MediaModule,
 * SessionsModule, ClassroomModule itself) can import it without creating
 * a cycle — the same reasoning as BatchAccessService.
 *
 * Takes `Pick<JwtPayload, 'sub' | 'role'>` rather than the full JwtPayload
 * — that's all any check here needs, and it lets callers that only hold a
 * teacherId (e.g. ControlGateway routing a delta to a teacher's dashboard
 * room) build a minimal principal without a real serviceNumber to hand.
 */
@Injectable()
export class ClassAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async activeClassForTeacher(teacherId: string) {
    return this.prisma.liveClass.findFirst({ where: { teacherId, state: 'ACTIVE' } });
  }

  /** Station ids a TEACHER may see/control; ADMIN gets `'all'`, meaning "no filter". */
  async controllableStationIds(user: Pick<JwtPayload, 'sub' | 'role'>): Promise<'all' | string[]> {
    if (user.role === UserRole.ADMIN) return 'all';
    const rows = await this.prisma.station.findMany({
      where: { liveClass: { teacherId: user.sub, state: 'ACTIVE' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async filterControllable(user: Pick<JwtPayload, 'sub' | 'role'>, stationIds: string[]): Promise<string[]> {
    const controllable = await this.controllableStationIds(user);
    if (controllable === 'all') return stationIds;
    const allowed = new Set(controllable);
    return stationIds.filter((id) => allowed.has(id));
  }

  /** Throws unless `user` is ADMIN or `stationId` is in their active class. */
  async assertCanControlStation(user: Pick<JwtPayload, 'sub' | 'role'>, stationId: string): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const controllable = await this.controllableStationIds(user);
    if (controllable !== 'all' && !controllable.includes(stationId)) {
      throw new ForbiddenException('This computer is not in your class');
    }
  }
}
