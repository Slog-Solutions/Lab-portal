import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type ClaimStationDto, type JoinLiveClassDto, type StartClassDto } from '@lab/shared';
import { classBroadcastRoom } from '@lab/shared/events';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { randomCode } from '../../common/random-code';
import { AuditService } from '../audit/audit.service';
import { StationsService } from '../stations/stations.service';
import { PresenceService } from '../control/presence.service';
import { SessionStateService } from '../control/session-state.service';
import { ControlGateway } from '../control/control.gateway';
import { LockService } from '../control/lock.service';
import { ScreenShareService } from '../control/screen-share.service';
import { MediaService } from '../media/media.service';
import { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

// The alphabet lives in common/random-code.ts, shared with batch join keys.
const CLASS_CODE_LENGTH = 6;
const CLASS_CODE_CREATE_ATTEMPTS = 5;

export interface ClassView {
  id: string;
  code: string;
  title: string;
  state: 'ACTIVE' | 'ENDED';
  memberCount: number;
  /** Set when this live class was started FROM a My Classes roster
   * ("Start Live Class" on ClassDetailPage) rather than ad hoc from Lab
   * Control — see LiveClass.batchId's own comment. */
  batchId: string | null;
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
    private readonly screenShares: ScreenShareService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  /** Idempotent — a teacher who already has an active class just gets it
   * back, so double-clicking "Start class" (or two tabs) never spawns a
   * second live code.
   *
   * `dto.batchId` ("Start Live Class" on ClassDetailPage) scopes the class
   * to one My Classes roster instead of leaving it ad hoc: the default
   * title becomes the class's own name, and every enrolled student already
   * signed in is attached in this same call (StationsService.
   * attachEnrolledStudents) — anyone who signs in later auto-joins too, via
   * StationsService.claim's no-code branch, for as long as this class stays
   * ACTIVE. An already-active class simply has its scope extended to the
   * new batch (students already in it are unaffected); a teacher can only
   * ever have one batch in scope at a time, matching the existing
   * one-active-class-per-teacher model. */
  async start(user: JwtPayload, dto: StartClassDto): Promise<ClassView> {
    if (dto.batchId) await this.batchAccess.assertCanUseBatch(user, dto.batchId);

    const existing = await this.prisma.liveClass.findFirst({ where: { teacherId: user.sub, state: 'ACTIVE' } });
    let liveClass: { id: string; code: string; title: string; state: string; teacherId: string; batchId: string | null };
    if (existing) {
      liveClass = dto.batchId && existing.batchId !== dto.batchId
        ? await this.prisma.liveClass.update({ where: { id: existing.id }, data: { batchId: dto.batchId } })
        : existing;
    } else {
      const teacher = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
      const title = dto.title?.trim() || (dto.batchId ? await this.batchName(dto.batchId) : `${teacher.fullName}'s class`);
      liveClass = await this.createWithUniqueCode(user.sub, title, dto.batchId);
      await this.media.ensureRoom(classBroadcastRoom(liveClass.id));
      await this.audit.log({
        actorId: user.sub,
        action: 'class.start',
        detail: { classId: liveClass.id, code: liveClass.code, batchId: dto.batchId ?? null },
      });
    }

    if (dto.batchId) await this.attachAlreadySignedInStudents(liveClass, dto.batchId);
    return this.toClassView(liveClass);
  }

  /** The bulk half of a batch-scoped start: everyone in the roster who is
   * already seated joins immediately, exactly as if each had typed the
   * code themselves (see StationsService.attachEnrolledStudents and
   * applyLiveClassAttach). Anyone not currently signed in needs nothing
   * further — StationsService.claim picks them up automatically at
   * sign-in time. */
  private async attachAlreadySignedInStudents(liveClass: { id: string; teacherId: string }, batchId: string): Promise<void> {
    const enrolled = await this.prisma.enrollment.findMany({ where: { batchId }, select: { userId: true } });
    if (enrolled.length === 0) return;
    const attaches = await this.stations.attachEnrolledStudents(liveClass.id, enrolled.map((e) => e.userId));
    for (const a of attaches) {
      await this.applyLiveClassAttach(a.stationId, a.seatNo, liveClass, a.previousTeacherId);
    }
  }

  private async batchName(batchId: string): Promise<string> {
    const batch = await this.prisma.batch.findUniqueOrThrow({ where: { id: batchId }, select: { name: true } });
    return batch.name;
  }

  async current(user: JwtPayload): Promise<ClassView | null> {
    const liveClass = await this.prisma.liveClass.findFirst({ where: { teacherId: user.sub, state: 'ACTIVE' } });
    return liveClass ? this.toClassView(liveClass) : null;
  }

  /** Allowed for the owning teacher or an ADMIN (decision: "the teacher
   * then has full control ... and only those", with ADMIN always able to
   * override). Ending a class only tears down the broadcast/roster link —
   * decision: a student stays signed in at their seat (and keeps their
   * system number) and simply drops back to "no live class"; only an
   * explicit release (releaseStudent/signOut) signs a student out. */
  async end(classId: string, user: JwtPayload): Promise<ClassView> {
    const liveClass = await this.prisma.liveClass.findUnique({ where: { id: classId } });
    if (!liveClass) throw new NotFoundException('Class not found');
    if (user.role !== UserRole.ADMIN && liveClass.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your class');
    }
    if (liveClass.state === 'ENDED') {
      return { id: liveClass.id, code: liveClass.code, title: liveClass.title, state: 'ENDED', memberCount: 0, batchId: liveClass.batchId };
    }

    const members = await this.prisma.station.findMany({ where: { liveClassId: classId }, select: { id: true, seatNo: true } });
    await this.prisma.$transaction([
      this.prisma.liveClass.update({ where: { id: classId }, data: { state: 'ENDED', endedAt: new Date() } }),
      this.prisma.station.updateMany({ where: { liveClassId: classId }, data: { liveClassId: null } }),
    ]);

    for (const member of members) {
      // Otherwise, once a locked station leaves the class, the teacher's
      // Unlock would 403 (station out of their class) and the lock lease
      // would renew forever — see ControlGateway's 15s heartbeat.
      await this.locks.unlock(member.id);
      // currentUserId is untouched by the transaction above — the student
      // stays seated, so seatOccupant bookkeeping needs no update here.
      if (member.seatNo !== null) this.presence.setMembership(member.id, { seatNo: member.seatNo, classTeacherId: null });
      const snapshot = await this.sessionState.getDesiredState(member.id);
      this.gateway.pushSnapshot(member.id, snapshot);
    }

    await this.media.deleteRoom(classBroadcastRoom(classId));
    // The LiveKit room is gone, but ScreenShareService's in-memory
    // reservation is a separate piece of state (design doc §2.2) — without
    // this, isPresenting() would keep reporting a station as "still
    // presenting" into a room that no longer exists until the server
    // itself restarts.
    this.screenShares.clearRoom(classBroadcastRoom(classId));
    await this.gateway.sendFullStatusToTeacher(liveClass.teacherId);
    await this.audit.log({ actorId: user.sub, action: 'class.end', detail: { classId, memberCount: members.length } });

    return { id: liveClass.id, code: liveClass.code, title: liveClass.title, state: 'ENDED', memberCount: 0, batchId: liveClass.batchId };
  }

  /** A student signing in at a seat — delegates the actual credential/seat/
   * class-code logic to StationsService.claim (still Prisma-only) and
   * layers on the live-presence/dashboard side effects that only this
   * module can reach (PresenceService, ControlGateway). Signing in needs no
   * class: `liveClass` is null unless the (optional) classCode was given —
   * see joinLiveClass for attaching the seat afterwards. */
  async signIn(stationId: string, dto: ClaimStationDto) {
    const result = await this.stations.claim(stationId, dto, {
      isStationOnline: (id) => this.presence.isOnline(id),
    });

    this.presence.setMembership(stationId, { seatNo: result.seatNo, classTeacherId: result.liveClass?.teacherId ?? null });
    // The lock follows the student: if they were locked at a previous
    // seat (or ever, as a standing grant), signing in here re-attaches it
    // to this station before the snapshot below is computed.
    this.locks.setSeatOccupant(stationId, result.userId);
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
      liveClass: result.liveClass
        ? { id: result.liveClass.id, title: result.liveClass.title, teacherName: result.liveClass.teacherName }
        : null,
    };
  }

  /** An already-signed-in student attaching their seat to a teacher's live
   * class — by typing a code themselves (joinLiveClass), or in bulk when a
   * teacher starts a batch-scoped class (attachAlreadySignedInStudents).
   * Either way the room-state side effects are identical: presence
   * membership, a fresh snapshot (which is what grants the class broadcast
   * room and is what makes StudentConsole show the class with no page
   * reload), and the dashboard status rows. A seat that MOVES between
   * classes also drops any spotlight reservation it held in the old room,
   * and the teacher it left gets their board refreshed. */
  private async applyLiveClassAttach(
    stationId: string,
    seatNo: number | null,
    liveClass: { id: string; teacherId: string },
    previousTeacherId: string | null,
  ): Promise<void> {
    if (previousTeacherId && previousTeacherId !== liveClass.teacherId) {
      this.screenShares.clearByStation(stationId);
    }
    if (seatNo !== null) this.presence.setMembership(stationId, { seatNo, classTeacherId: liveClass.teacherId });
    const snapshot = await this.sessionState.getDesiredState(stationId);
    this.gateway.pushSnapshot(stationId, snapshot);
    await this.gateway.sendStatusRow(stationId);
    if (previousTeacherId && previousTeacherId !== liveClass.teacherId) {
      await this.gateway.sendFullStatusToTeacher(previousTeacherId);
    }
  }

  async joinLiveClass(stationId: string, dto: JoinLiveClassDto) {
    const { seatNo, liveClass, previousTeacherId } = await this.stations.attachToLiveClass(stationId, dto.classCode);
    await this.applyLiveClassAttach(stationId, seatNo, liveClass, previousTeacherId);
    return { ok: true as const, liveClass: { id: liveClass.id, title: liveClass.title, teacherName: liveClass.teacherName } };
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

  private async releaseAndNotify(stationId: string, actorId: string | undefined, reason: 'released'): Promise<void> {
    // Read before release() clears liveClassId in the DB and before we
    // clear presence's own copy — this is the only way to reach the
    // departing student's (soon to be former) teacher's dashboard room,
    // since sendStatusRow alone would only ever see "no class" from here on.
    const classTeacherId = this.presence.get(stationId)?.classTeacherId ?? null;
    // NOT the full unlock() — that would also delete the departing
    // student's own persisted grant, defeating "the lock follows the
    // student". Detach them from this seat and clear only whatever
    // station-scoped grant this specific PC might separately hold.
    this.locks.setSeatOccupant(stationId, null);
    await this.locks.clearStationGrant(stationId);
    // A released station's fresh snapshot (pushed below) no longer grants
    // it that class's broadcast room at all, so reconcileRooms disconnects
    // it and the screen/mic tracks stop on their own — but the in-memory
    // spotlight reservation needs clearing explicitly, same reasoning as
    // ClassroomService.end's classBroadcastRoom cleanup.
    this.screenShares.clearByStation(stationId);
    await this.stations.release(stationId, actorId);
    const seatNo = this.presence.get(stationId)?.seatNo ?? null;
    if (seatNo !== null) this.presence.setMembership(stationId, { seatNo, classTeacherId: null });

    this.gateway.emitToStation(stationId, 'student:signed-out', { reason });
    const snapshot = await this.sessionState.getDesiredState(stationId);
    this.gateway.pushSnapshot(stationId, snapshot);
    if (classTeacherId) await this.gateway.sendFullStatusToTeacher(classTeacherId);
  }

  private async createWithUniqueCode(teacherId: string, title: string, batchId?: string) {
    for (let attempt = 0; attempt < CLASS_CODE_CREATE_ATTEMPTS; attempt++) {
      const code = randomCode(CLASS_CODE_LENGTH);
      try {
        return await this.prisma.liveClass.create({ data: { code, title, teacherId, batchId } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new ConflictException('Could not generate a unique classroom code — please try again');
  }

  private async toClassView(liveClass: { id: string; code: string; title: string; state: string; batchId: string | null }): Promise<ClassView> {
    const memberCount = await this.prisma.station.count({ where: { liveClassId: liveClass.id } });
    return {
      id: liveClass.id,
      code: liveClass.code,
      title: liveClass.title,
      state: liveClass.state as ClassView['state'],
      memberCount,
      batchId: liveClass.batchId,
    };
  }
}
