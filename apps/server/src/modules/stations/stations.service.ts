import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  StationLifecycle,
  UserRole,
  type ClaimStationDto,
  type StationAssignSeatDto,
  type StationRegisterDto,
  type StationStatusRow,
} from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

/** Shared `include` for every query that needs to build a StationStatusRow
 * (listStatusBoard's full sweep and getStatusRow's single-row lookup) — one
 * shape, so the two can never quietly drift apart. */
const STATUS_ROW_INCLUDE = {
  sessionMembers: { include: { group: { include: { session: true, activity: true } } } },
  currentUser: { select: { id: true, serviceNumber: true, fullName: true } },
  liveClass: { select: { id: true, title: true, teacherId: true, teacher: { select: { fullName: true } } } },
} satisfies Prisma.StationInclude;

type StationWithStatusIncludes = Prisma.StationGetPayload<{ include: typeof STATUS_ROW_INCLUDE }>;

export interface LiveClassSummary {
  id: string;
  title: string;
  teacherId: string;
  teacherName: string;
}

const BAD_CLASS_CODE_MESSAGE = 'Classroom code is invalid or the class has ended';

export interface ClaimResult {
  userId: string;
  fullName: string;
  serviceNumber: string;
  studentToken: string;
  seatNo: number;
  /** Null when the student signed in without a class code — signing in
   * never needs a class; they can attach the seat later with
   * StationsService.attachToLiveClass. */
  liveClass: LiveClassSummary | null;
  /** Set when this claim bumped an *offline* station off the same system
   * number (StationsService.claim step 3) — callers push a fresh status
   * row for that station too, since its seatNo just changed under it. */
  movedFromStationId: string | null;
}

/**
 * Station identity is machineGuid, never hostname/MAC (design doc §3.7) —
 * both drift (rename, NIC replacement); MachineGuid does not.
 */
@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** First-boot self-registration. Idempotent: re-registering updates, never duplicates.
   * `classTeacherId` mirrors the station's current LiveClass (if any) so
   * ControlGateway can seed PresenceEntry.classTeacherId at hello without a
   * second query — a station reconnecting mid-class must keep routing
   * status deltas to its teacher's dashboard room immediately, not just
   * after the next sign-in. */
  async register(dto: StationRegisterDto): Promise<{ stationId: string; seatNo: number | null; classTeacherId: string | null }> {
    const station = await this.prisma.station.upsert({
      where: { machineGuid: dto.machineGuid },
      update: {
        hostname: dto.hostname,
        macs: dto.macs,
        appVersion: dto.appVersion,
        osBuild: dto.osBuild,
        lastSeenAt: new Date(),
      },
      create: {
        machineGuid: dto.machineGuid,
        hostname: dto.hostname,
        macs: dto.macs,
        appVersion: dto.appVersion,
        osBuild: dto.osBuild,
        lifecycle: StationLifecycle.UNCLAIMED,
        lastSeenAt: new Date(),
      },
      include: { liveClass: { select: { teacherId: true } } },
    });
    return { stationId: station.id, seatNo: station.seatNo, classTeacherId: station.liveClass?.teacherId ?? null };
  }

  /** Admin manual override — still available as a fallback even though a
   * student's own sign-in now assigns a seat automatically (see claim()). */
  async assignSeat(dto: StationAssignSeatDto, actorId: string): Promise<void> {
    const existing = await this.prisma.station.findUnique({ where: { seatNo: dto.seatNo } });
    if (existing && existing.id !== dto.stationId) {
      throw new BadRequestException(
        `Seat ${dto.seatNo} is already assigned to station ${existing.id}. Use swapSeats to exchange two seats.`,
      );
    }
    const station = await this.prisma.station.update({
      where: { id: dto.stationId },
      data: { seatNo: dto.seatNo, lifecycle: StationLifecycle.OFFLINE },
    });
    await this.audit.log({
      actorId,
      stationId: station.id,
      action: 'station.assign_seat',
      detail: { seatNo: dto.seatNo },
    });
  }

  /** Atomic swap — the common re-mapping operation admins actually perform. */
  async swapSeats(stationIdA: string, stationIdB: string, actorId: string): Promise<void> {
    const [a, b] = await Promise.all([
      this.prisma.station.findUniqueOrThrow({ where: { id: stationIdA } }),
      this.prisma.station.findUniqueOrThrow({ where: { id: stationIdB } }),
    ]);
    await this.prisma.$transaction([
      // Null out both first — seatNo has a unique constraint, so a
      // direct A<->B swap would collide mid-transaction.
      this.prisma.station.update({ where: { id: a.id }, data: { seatNo: null } }),
      this.prisma.station.update({ where: { id: b.id }, data: { seatNo: null } }),
      this.prisma.station.update({ where: { id: a.id }, data: { seatNo: b.seatNo } }),
      this.prisma.station.update({ where: { id: b.id }, data: { seatNo: a.seatNo } }),
    ]);
    await this.audit.log({
      actorId,
      action: 'station.swap_seats',
      detail: { stationIdA, stationIdB, seatA: a.seatNo, seatB: b.seatNo },
    });
  }

  async findByMachineGuid(machineGuid: string) {
    const station = await this.prisma.station.findUnique({ where: { machineGuid } });
    if (!station) throw new NotFoundException('Station not registered');
    return station;
  }

  async findById(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw new NotFoundException('Station not found');
    return station;
  }

  async markSeen(stationId: string, patch: { lifecycle?: StationLifecycle; ip?: string }): Promise<void> {
    await this.prisma.station.update({
      where: { id: stationId },
      data: {
        lastSeenAt: new Date(),
        lifecycle: patch.lifecycle,
        lastIp: patch.ip,
      },
    });
  }

  /** Ser 1 "disable student stations". Enforced by SessionStateService
   * returning stationEnabled:false, which the client treats as a hard
   * block regardless of what session/activity it would otherwise join. */
  async setEnabled(stationId: string, enabled: boolean): Promise<void> {
    await this.prisma.station.update({ where: { id: stationId }, data: { enabled } });
  }

  /**
   * A student's real login at a seat, now also the one place a PC gets its
   * seat number: whatever `systemNumber` the student types (the number
   * printed on the PC's own screen) becomes `seatNo` via
   * seatNoFromSystemNumber — no admin step. The station token proves "this
   * HTTP caller is a genuine seat"; the student's own password proves who
   * they are (AuthService.authenticate, same check a dashboard login
   * uses); `classCode` is OPTIONAL — when given it must match an ACTIVE
   * LiveClass, when omitted the student just signs in with no class. Each
   * failure mode short-circuits to a message that reveals nothing more than
   * necessary — see each branch's own audit reason.
   *
   * `opts.isStationOnline` is injected rather than imported directly
   * because live presence lives in PresenceService (ControlModule), and
   * StationsModule must not depend on ControlModule (see
   * stations.controller.ts's comment on the reverse-import cycle this
   * avoids) — ClassroomService, which already depends on both, passes it
   * through.
   */
  async claim(
    stationId: string,
    dto: ClaimStationDto,
    opts: { isStationOnline: (stationId: string) => boolean },
  ): Promise<ClaimResult> {
    let user;
    try {
      user = await this.auth.authenticate(dto.serviceNumber, dto.password);
    } catch (err) {
      await this.audit.log({
        stationId,
        action: 'station.claim_failed',
        detail: { serviceNumber: dto.serviceNumber, reason: 'invalid_credentials' },
      });
      throw err;
    }
    if (user.role !== UserRole.STUDENT) {
      await this.audit.log({
        stationId,
        action: 'station.claim_failed',
        detail: { serviceNumber: dto.serviceNumber, reason: 'not_a_student' },
      });
      // Same message as an actual bad password — a station must never be
      // able to tell "wrong password" apart from "right password, wrong role".
      throw new UnauthorizedException('Invalid credentials');
    }

    let liveClass: LiveClassSummary | null = null;
    if (dto.classCode) {
      liveClass = await this.findActiveLiveClass(dto.classCode);
      if (!liveClass) {
        await this.audit.log({
          stationId,
          action: 'station.claim_failed',
          detail: { serviceNumber: dto.serviceNumber, reason: 'bad_class_code', code: dto.classCode.trim().toUpperCase() },
        });
        throw new BadRequestException(BAD_CLASS_CODE_MESSAGE);
      }
    } else {
      // No code typed — still auto-join if a teacher has started a live
      // class scoped to one of this student's enrolled classes ("Start
      // Live Class" on ClassDetailPage; see ClassroomService.start's
      // batchId branch). An enrolled-but-not-live student is simply not
      // attached, never an error — this is a courtesy match, not a
      // requirement to be enrolled anywhere.
      liveClass = await this.findActiveLiveClassForStudent(user.id);
    }

    const seatNo = dto.systemNumber + 1; // seatNoFromSystemNumber — inlined to avoid a runtime dep on @lab/shared here
    let movedFromStationId: string | null = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const seatHolder = await tx.station.findUnique({ where: { seatNo } });
        if (seatHolder && seatHolder.id !== stationId) {
          if (opts.isStationOnline(seatHolder.id)) {
            throw new ConflictException(
              `System number ${dto.systemNumber} is already in use by another computer — check the number on your screen`,
            );
          }
          // The seat's previous occupant is offline (stale row — a PC was
          // re-imaged or swapped) — free the number rather than blocking
          // the student standing at the keyboard right now. That station
          // keeps its own claimed student/class; only its seatNo moves.
          await tx.station.update({ where: { id: seatHolder.id }, data: { seatNo: null } });
          movedFromStationId = seatHolder.id;
        }
        await tx.station.update({
          where: { id: stationId },
          data: { seatNo, currentUserId: user.id, liveClassId: liveClass?.id ?? null, lifecycle: StationLifecycle.READY },
        });
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        await this.audit.log({
          stationId,
          action: 'station.claim_failed',
          detail: { serviceNumber: dto.serviceNumber, reason: 'seat_in_use', systemNumber: dto.systemNumber },
        });
        throw err;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = err.meta?.target;
        const targetsSeat = Array.isArray(target) ? target.includes('seatNo') : String(target ?? '').includes('seatNo');
        if (targetsSeat) {
          // The true race the pre-check above can't fully close (two
          // concurrent claims for the same seat) — the unique constraint
          // on Station.seatNo is the actual guarantee; this is just
          // turning it into the same friendly message.
          await this.audit.log({
            stationId,
            action: 'station.claim_failed',
            detail: { serviceNumber: dto.serviceNumber, reason: 'seat_in_use', systemNumber: dto.systemNumber },
          });
          throw new ConflictException(
            `System number ${dto.systemNumber} is already in use by another computer — check the number on your screen`,
          );
        }
        await this.audit.log({
          stationId,
          action: 'station.claim_failed',
          detail: { serviceNumber: dto.serviceNumber, reason: 'already_claimed' },
        });
        throw new ConflictException('This student is already claimed at another station');
      }
      throw err;
    }

    if (movedFromStationId) {
      await this.audit.log({
        actorId: null,
        stationId: movedFromStationId,
        action: 'station.seat_moved',
        detail: { seatNo, toStationId: stationId },
      });
    }

    const studentToken = await this.auth.issueUserToken(user);
    // Never log the password itself — same rule UsersService.resetPassword follows.
    await this.audit.log({
      stationId,
      action: 'station.claim',
      detail: { userId: user.id, serviceNumber: user.serviceNumber, seatNo, liveClassId: liveClass?.id ?? null },
    });
    return {
      userId: user.id,
      fullName: user.fullName,
      serviceNumber: user.serviceNumber,
      studentToken,
      seatNo,
      liveClass,
      movedFromStationId,
    };
  }

  /**
   * A signed-in student attaching their seat to a teacher's live class after
   * the fact (POST /classroom/join) — the counterpart to sign-in no longer
   * needing a class. Which student is seated comes from
   * Station.currentUserId, exactly like attempts do, so a station with
   * nobody signed in cannot join anything. Re-joining a different class
   * simply moves the seat; `previousTeacherId` lets the caller refresh the
   * teacher who just lost it.
   */
  async attachToLiveClass(
    stationId: string,
    classCode: string,
  ): Promise<{ seatNo: number | null; liveClass: LiveClassSummary; previousTeacherId: string | null }> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { currentUserId: true, seatNo: true, liveClass: { select: { teacherId: true } } },
    });
    if (!station) throw new NotFoundException('Station not found');
    if (!station.currentUserId) throw new BadRequestException('Sign in before joining a class');

    const liveClass = await this.findActiveLiveClass(classCode);
    if (!liveClass) {
      await this.audit.log({
        stationId,
        action: 'station.join_class_failed',
        detail: { userId: station.currentUserId, reason: 'bad_class_code', code: classCode.trim().toUpperCase() },
      });
      throw new BadRequestException(BAD_CLASS_CODE_MESSAGE);
    }

    await this.prisma.station.update({ where: { id: stationId }, data: { liveClassId: liveClass.id } });
    await this.audit.log({
      stationId,
      action: 'station.join_class',
      detail: { userId: station.currentUserId, liveClassId: liveClass.id },
    });
    return { seatNo: station.seatNo, liveClass, previousTeacherId: station.liveClass?.teacherId ?? null };
  }

  /** Case-insensitive lookup of an ACTIVE LiveClass by its code; null when
   * there is none (unknown code and ended class are deliberately the same). */
  private async findActiveLiveClass(classCode: string): Promise<LiveClassSummary | null> {
    const found = await this.prisma.liveClass.findFirst({
      where: { code: classCode.trim().toUpperCase(), state: 'ACTIVE' },
      include: { teacher: { select: { fullName: true } } },
    });
    return found ? { id: found.id, title: found.title, teacherId: found.teacherId, teacherName: found.teacher.fullName } : null;
  }

  /** The no-code counterpart to findActiveLiveClass, keyed by roster
   * membership instead of a typed code — see claim()'s else branch. A
   * student can be enrolled in several classes; if more than one happens
   * to have an active batch-scoped live class right now, the most
   * recently started one wins (the one most likely to be happening now). */
  private async findActiveLiveClassForStudent(studentId: string): Promise<LiveClassSummary | null> {
    const enrollments = await this.prisma.enrollment.findMany({ where: { userId: studentId }, select: { batchId: true } });
    if (enrollments.length === 0) return null;
    const found = await this.prisma.liveClass.findFirst({
      where: { batchId: { in: enrollments.map((e) => e.batchId) }, state: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      include: { teacher: { select: { fullName: true } } },
    });
    return found ? { id: found.id, title: found.title, teacherId: found.teacherId, teacherName: found.teacher.fullName } : null;
  }

  /** Bulk counterpart to attachToLiveClass, driven by roster membership
   * instead of a station typing a code (ClassroomService.start's batchId
   * branch — "Start Live Class" attaches every already-signed-in enrolled
   * student in one step). Returns just enough per station for the caller
   * to replay attachToLiveClass's own side effects (presence, a fresh
   * snapshot, the dashboard status row) for each one. A station already in
   * this exact class is left alone — not an error, just nothing to do. */
  async attachEnrolledStudents(
    liveClassId: string,
    studentIds: string[],
  ): Promise<Array<{ stationId: string; seatNo: number | null; previousTeacherId: string | null }>> {
    if (studentIds.length === 0) return [];
    const stations = await this.prisma.station.findMany({
      // Prisma's `not` on a nullable column excludes NULL rows outright
      // (three-valued SQL logic: `liveClassId != x` is unknown, not true,
      // when liveClassId IS NULL) — verified live against this dev DB. Most
      // signed-in students have no class at all, so `{ not: liveClassId }`
      // alone would silently skip almost everyone; the explicit null arm is
      // what actually catches them.
      where: { currentUserId: { in: studentIds }, OR: [{ liveClassId: null }, { liveClassId: { not: liveClassId } }] },
      select: { id: true, seatNo: true, currentUserId: true, liveClass: { select: { teacherId: true } } },
    });
    if (stations.length === 0) return [];

    await this.prisma.station.updateMany({
      where: { id: { in: stations.map((s) => s.id) } },
      data: { liveClassId },
    });
    await Promise.all(
      stations.map((s) =>
        this.audit.log({
          stationId: s.id,
          action: 'station.join_class',
          detail: { userId: s.currentUserId, liveClassId, auto: true },
        }),
      ),
    );
    return stations.map((s) => ({ stationId: s.id, seatNo: s.seatNo, previousTeacherId: s.liveClass?.teacherId ?? null }));
  }

  /** `actorId` set means this was an admin/teacher force-release from the
   * dashboard rather than the station releasing itself (e.g. end of day,
   * or a student claimed the wrong seat) — audited under a distinct
   * action so the log can tell the two apart. `seatNo` is deliberately
   * kept (decision: "each PC keeps its system number") — only the
   * student/class link is cleared. */
  async release(stationId: string, actorId?: string): Promise<void> {
    await this.prisma.station.update({ where: { id: stationId }, data: { currentUserId: null, liveClassId: null } });
    await this.audit.log({
      actorId,
      stationId,
      action: actorId ? 'station.release_forced' : 'station.release',
    });
  }

  /** Powers the lab status board (design doc §4.4). */
  async listStatusBoard(): Promise<StationStatusRow[]> {
    const stations = await this.prisma.station.findMany({
      where: { archivedAt: null },
      orderBy: { seatNo: 'asc' },
      include: STATUS_ROW_INCLUDE,
    });
    return stations.map((s) => this.toStatusRow(s));
  }

  /** Single-row counterpart to listStatusBoard, used by ControlGateway to
   * push a live update for exactly one station (e.g. right after a
   * classroom sign-in) without resending the whole board. Returns the
   * class's teacherId alongside the wire row — needed to route the socket
   * emit to that teacher's dashboard room, but not part of StationStatusRow
   * itself. */
  async getStatusRow(stationId: string): Promise<{ row: StationStatusRow; classTeacherId: string | null } | null> {
    const s = await this.prisma.station.findUnique({ where: { id: stationId }, include: STATUS_ROW_INCLUDE });
    if (!s || s.archivedAt) return null;
    return { row: this.toStatusRow(s), classTeacherId: s.liveClass?.teacherId ?? null };
  }

  private toStatusRow(s: StationWithStatusIncludes): StationStatusRow {
    const member = s.sessionMembers[0];
    return {
      stationId: s.id,
      seatNo: s.seatNo,
      hostname: s.hostname,
      lifecycle: s.lifecycle as StationStatusRow['lifecycle'],
      appVersion: s.appVersion,
      osBuild: s.osBuild,
      ip: s.lastIp,
      lastSeenAt: s.lastSeenAt ? s.lastSeenAt.getTime() : null,
      sessionId: member?.group.sessionId ?? null,
      groupId: member?.groupId ?? null,
      activityType: (member?.group.activity?.type as StationStatusRow['activityType']) ?? null,
      lock: null, // populated live from in-memory presence state, not persisted per-poll
      mic: false,
      screenSharing: false,
      monitored: false,
      currentUser: s.currentUser,
      liveClass: s.liveClass ? { id: s.liveClass.id, title: s.liveClass.title, teacherName: s.liveClass.teacher.fullName } : null,
    } satisfies StationStatusRow;
  }
}
