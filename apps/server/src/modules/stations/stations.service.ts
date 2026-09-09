import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  StationLifecycle,
  UserRole,
  type StationAssignSeatDto,
  type StationRegisterDto,
  type StationStatusRow,
} from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Station identity is machineGuid, never hostname/MAC (design doc §3.7) —
 * both drift (rename, NIC replacement); MachineGuid does not.
 */
@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** First-boot self-registration. Idempotent: re-registering updates, never duplicates. */
  async register(dto: StationRegisterDto): Promise<{ stationId: string; seatNo: number | null }> {
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
    });
    return { stationId: station.id, seatNo: station.seatNo };
  }

  /** Admin assigns a seat 1-41. Rejects collision explicitly rather than silently stealing a seat. */
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
   * Phase 3 — Station.currentUserId existed since Phase 0 (schema) but no
   * server code ever set it (grep-verified during Phase 3 recon). Not a
   * login: no password, just naming which enrolled student is physically
   * at this seat, so an assessment attempt has a real studentId to grade
   * against. `@unique` on currentUserId means a student can be claimed at
   * only one station at a time — the DB enforces "not in two seats at once".
   */
  async claim(stationId: string, serviceNumber: string): Promise<{ userId: string; fullName: string }> {
    const user = await this.prisma.user.findUnique({ where: { serviceNumber } });
    if (!user || user.role !== UserRole.STUDENT || !user.active) {
      throw new BadRequestException('No active student account matches that service number');
    }
    try {
      await this.prisma.station.update({ where: { id: stationId }, data: { currentUserId: user.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This student is already claimed at another station');
      }
      throw err;
    }
    await this.audit.log({ stationId, action: 'station.claim', detail: { userId: user.id, serviceNumber } });
    return { userId: user.id, fullName: user.fullName };
  }

  /** `actorId` set means this was an admin/teacher force-release from the
   * dashboard rather than the station releasing itself (e.g. end of day,
   * or a student claimed the wrong seat) — audited under a distinct
   * action so the log can tell the two apart. */
  async release(stationId: string, actorId?: string): Promise<void> {
    await this.prisma.station.update({ where: { id: stationId }, data: { currentUserId: null } });
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
      include: {
        sessionMembers: {
          include: { group: { include: { session: true, activity: true } } },
        },
        currentUser: { select: { id: true, serviceNumber: true, fullName: true } },
      },
    });

    return stations.map((s) => {
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
      } satisfies StationStatusRow;
    });
  }
}
