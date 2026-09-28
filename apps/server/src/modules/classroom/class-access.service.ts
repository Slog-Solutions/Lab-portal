import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Single authority for "which stations may this principal see/control"
 * (see build plan "teacher-wide remote control: lock / unlock / shutdown
 * / restart without a student login"). A TEACHER controls EVERY lab PC,
 * always — no active class required (design decision, 2026-09-18). This
 * governs lock/shutdown/restart/enable/disable and the status board.
 *
 * Class scoping still matters for MEDIA — activeClassForTeacher gates
 * spotlight, group monitoring and the class broadcast room
 * (ControlController.resolveBroadcastRoom), since those genuinely need a
 * LiveKit room to exist. Lock/shutdown/restart need no such room, so they
 * are no longer scoped by it — a teacher with no active class can still
 * lock an idle PC nobody has signed into yet.
 *
 * Deliberately Prisma-only, importing nothing else, so every module that
 * needs this check (ControlModule, MediaModule, SessionsModule,
 * ClassroomModule itself) can import it without creating a cycle — the
 * same reasoning as BatchAccessService.
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

  /** Station ids a principal may see/control — `'all'` for both ADMIN and
   * TEACHER, meaning "no filter" (see this service's doc comment). Kept
   * as an (async) `'all' | string[]` union rather than collapsing to a
   * plain boolean so a future narrower role can still return a real list
   * without changing every call site's shape. */
  async controllableStationIds(_user: Pick<JwtPayload, 'sub' | 'role'>): Promise<'all' | string[]> {
    return 'all';
  }

  async filterControllable(user: Pick<JwtPayload, 'sub' | 'role'>, stationIds: string[]): Promise<string[]> {
    const controllable = await this.controllableStationIds(user);
    if (controllable === 'all') return stationIds;
    const allowed = new Set(controllable);
    return stationIds.filter((id) => allowed.has(id));
  }

  /** Throws unless `stationId` is controllable by `user` — today, never
   * (both roles get `'all'`); kept as a real check rather than deleted so
   * a future narrower role has a call site already wired everywhere. */
  async assertCanControlStation(user: Pick<JwtPayload, 'sub' | 'role'>, stationId: string): Promise<void> {
    const controllable = await this.controllableStationIds(user);
    if (controllable !== 'all' && !controllable.includes(stationId)) {
      throw new ForbiddenException('This computer is not in your class');
    }
  }
}
