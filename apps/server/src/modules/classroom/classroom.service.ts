import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { UserRole, type ClaimStationDto, type StartClassDto } from '@lab/shared';
import { classBroadcastRoom } from '@lab/shared/events';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StationsService } from '../stations/stations.service';
import { PresenceService } from '../control/presence.service';
import { SessionStateService } from '../control/session-state.service';
import { ControlGateway } from '../control/control.gateway';
import { LockService } from '../control/lock.service';
import { MediaService } from '../media/media.service';
import type { JwtPayload } from '../auth/auth.service';

// Excludes visually-confusable characters (0/O, 1/I) — this is read out
// loud in a classroom and typed back in under time pressure.
const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLASS_CODE_LENGTH = 6;
const CLASS_CODE_CREATE_ATTEMPTS = 5;

function generateClassCode(): string {
  let code = '';
  for (let i = 0; i < CLASS_CODE_LENGTH; i++) {
    code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  }
  return code;
}

export interface ClassView {
  id: string;
  code: string;
  title: string;
  state: 'ACTIVE' | 'ENDED';
  memberCount: number;
}

/**
 * The classroom lifecycle (build plan "Student self-numbering + classroom
 * code with class-scoped teacher control"): a teacher starts a class and
 * gets a short code, students sign in with it (which is also what assigns
 * their seat — see StationsService.claim), and the teacher's control
 * surface everywhere else (ControlController, CommandsService,
 * SessionsService, MediaController) is scoped to exactly the stations
 * currently in that class via ClassAccessService.
 */
@Injectable()
export class ClassroomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stations: StationsService,
    private readonly presence: PresenceService,
    private readonly sessionState: SessionStateService,
    private readonly gateway: ControlGateway,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly locks: LockService,
  ) {}

  /** Idempotent — a teacher who already has an active class just gets it
   * back, so double-clicking "Start class" (or two tabs) never spawns a
   * second live code. */
  async start(user: JwtPayload, dto: StartClassDto): Promise<ClassView> {
    const existing = await this.prisma.liveClass.findFirst({ where: { teacherId: user.sub, state: 'ACTIVE' } });
    if (existing) return this.toClassView(existing);

    const teacher = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    const title = dto.title?.trim() || `${teacher.fullName}'s class`;
    const liveClass = await this.createWithUniqueCode(user.sub, title);

    await this.media.ensureRoom(classBroadcastRoom(liveClass.id));
    await this.audit.log({ actorId: user.sub, action: 'class.start', detail: { classId: liveClass.id, code: liveClass.code } });
    return this.toClassView(liveClass);
  }

  async current(user: JwtPayload): Promise<ClassView | null> {
    const liveClass = await this.prisma.liveClass.findFirst({ where: { teacherId: user.sub, state: 'ACTIVE' } });
    return liveClass ? this.toClassView(liveClass) : null;
  }

  /** Allowed for the owning teacher or an ADMIN (decision: "the teacher
   * then has full control ... and only those", with ADMIN always able to
   * override). Every member station is signed out and, per decision, KEEPS
   * its system number — only the currentUserId/liveClassId link clears. */
  async end(classId: string, user: JwtPayload): Promise<ClassView> {
    const liveClass = await this.prisma.liveClass.findUnique({ where: { id: classId } });
    if (!liveClass) throw new NotFoundException('Class not found');
    if (user.role !== UserRole.ADMIN && liveClass.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your class');
    }
    if (liveClass.state === 'ENDED') {
      return { id: liveClass.id, code: liveClass.code, title: liveClass.title, state: 'ENDED', memberCount: 0 };
    }

    const members = await this.prisma.station.findMany({ where: { liveClassId: classId }, select: { id: true, seatNo: true } });
    await this.prisma.$transaction([
      this.prisma.liveClass.update({ where: { id: classId }, data: { state: 'ENDED', endedAt: new Date() } }),
      this.prisma.station.updateMany({ where: { liveClassId: classId }, data: { currentUserId: null, liveClassId: null } }),
    ]);

    for (const member of members) {
      // Otherwise, once a locked station leaves the class, the teacher's
      // Unlock would 403 (station out of their class) and the lock lease
      // would renew forever — see ControlGateway's 15s heartbeat.
      this.locks.unlock(member.id);
      if (member.seatNo !== null) this.presence.setMembership(member.id, { seatNo: member.seatNo, classTeacherId: null });
      this.gateway.emitToStation(member.id, 'student:signed-out', { reason: 'class_ended' });
      const snapshot = await this.sessionState.getDesiredState(member.id);
      this.gateway.pushSnapshot(member.id, snapshot);
    }

    await this.media.deleteRoom(classBroadcastRoom(classId));
    await this.gateway.sendFullStatusToTeacher(liveClass.teacherId);
    await this.audit.log({ actorId: user.sub, action: 'class.end', detail: { classId, memberCount: members.length } });

    return { id: liveClass.id, code: liveClass.code, title: liveClass.title, state: 'ENDED', memberCount: 0 };
  }

  /** A student signing in at a seat — delegates the actual credential/seat/
   * class-code logic to StationsService.claim (still Prisma-only) and
   * layers on the live-presence/dashboard side effects that only this
   * module can reach (PresenceService, ControlGateway). */
  async signIn(stationId: string, dto: ClaimStationDto) {
    const result = await this.stations.claim(stationId, dto, {
      isStationOnline: (id) => this.presence.isOnline(id),
    });

    this.presence.setMembership(stationId, { seatNo: result.seatNo, classTeacherId: result.liveClass.teacherId });
    const snapshot = await this.sessionState.getDesiredState(stationId);
    this.gateway.pushSnapshot(stationId, snapshot);
    this.gateway.emitIdentity(stationId, result.seatNo);
    await this.gateway.sendStatusRow(stationId);
    if (result.movedFromStationId) {
      await this.gateway.sendStatusRow(result.movedFromStationId);
    }

    return {
      ok: true as const,
      userId: result.userId,
      fullName: result.fullName,
      serviceNumber: result.serviceNumber,
      studentToken: result.studentToken,
      seatNo: result.seatNo,
      liveClass: { id: result.liveClass.id, title: result.liveClass.title, teacherName: result.liveClass.teacherName },
    };
  }

  /** The station releasing itself (no actorId — see StationsService.release). */
  async signOut(stationId: string): Promise<{ ok: true }> {
    await this.releaseAndNotify(stationId, undefined, 'released');
    return { ok: true };
  }

  /** Dashboard-side force release — TEACHER (own class only, enforced by
   * the controller via ClassAccessService) or ADMIN. */
  async releaseStudent(stationId: string, user: JwtPayload): Promise<{ ok: true }> {
    await this.releaseAndNotify(stationId, user.sub, 'released');
    return { ok: true };
  }

  private async releaseAndNotify(stationId: string, actorId: string | undefined, reason: 'class_ended' | 'released'): Promise<void> {
    // Read before release() clears liveClassId in the DB and before we
    // clear presence's own copy — this is the only way to reach the
    // departing student's (soon to be former) teacher's dashboard room,
    // since sendStatusRow alone would only ever see "no class" from here on.
    const classTeacherId = this.presence.get(stationId)?.classTeacherId ?? null;
    this.locks.unlock(stationId);
    await this.stations.release(stationId, actorId);
    const seatNo = this.presence.get(stationId)?.seatNo ?? null;
    if (seatNo !== null) this.presence.setMembership(stationId, { seatNo, classTeacherId: null });

    this.gateway.emitToStation(stationId, 'student:signed-out', { reason });
    const snapshot = await this.sessionState.getDesiredState(stationId);
    this.gateway.pushSnapshot(stationId, snapshot);
    if (classTeacherId) await this.gateway.sendFullStatusToTeacher(classTeacherId);
  }

  private async createWithUniqueCode(teacherId: string, title: string) {
    for (let attempt = 0; attempt < CLASS_CODE_CREATE_ATTEMPTS; attempt++) {
      const code = generateClassCode();
      try {
        return await this.prisma.liveClass.create({ data: { code, title, teacherId } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new ConflictException('Could not generate a unique classroom code — please try again');
  }

  private async toClassView(liveClass: { id: string; code: string; title: string; state: string }): Promise<ClassView> {
    const memberCount = await this.prisma.station.count({ where: { liveClassId: liveClass.id } });
    return { id: liveClass.id, code: liveClass.code, title: liveClass.title, state: liveClass.state as ClassView['state'], memberCount };
  }
}
