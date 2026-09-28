import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { StationsService } from './stations.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthService } from '../auth/auth.service';

/**
 * StationsService.claim is the one place a classroom sign-in resolves
 * credentials + classroom code + system number into a real seat
 * assignment (see its own doc comment). No real Postgres here — a fake
 * PrismaService (including a callback-shaped `$transaction` that just
 * invokes the callback against the same `station` mock as `tx`) is enough
 * to exercise the real branching logic, following the mocking style of
 * attempts.service.spec.ts.
 */
function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  const station = { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() };
  return {
    station,
    liveClass: { findFirst: vi.fn() },
    enrollment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (cb: (tx: { station: typeof station }) => Promise<void>) => cb({ station })),
    ...overrides,
  };
}

function makeFakeAudit() {
  return { log: vi.fn() };
}

function makeFakeAuth(user: { id: string; role: string; fullName: string; serviceNumber: string }) {
  return {
    authenticate: vi.fn().mockResolvedValue(user),
    issueUserToken: vi.fn().mockResolvedValue('student-jwt'),
  };
}

function makeService(
  prisma: ReturnType<typeof makeFakePrisma>,
  audit: ReturnType<typeof makeFakeAudit>,
  auth: ReturnType<typeof makeFakeAuth>,
): StationsService {
  return new StationsService(prisma as unknown as PrismaService, audit as unknown as AuditService, auth as unknown as AuthService);
}

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target },
  });
}

const student = { id: 'stu1', role: UserRole.STUDENT, fullName: 'Student One', serviceNumber: 'STU-001' };
const dto = { serviceNumber: 'STU-001', password: 'secret123', systemNumber: 5, classCode: 'abcdef' };
const liveClass = { id: 'class1', code: 'ABCDEF', title: "Teacher's class", teacherId: 'teacher1', teacher: { fullName: 'Teacher One' } };

describe('StationsService.claim', () => {
  it('rejects an invalid/expired classroom code after credentials pass', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(null);
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    await expect(service.claim('station1', dto, { isStationOnline: () => false })).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.claim_failed', detail: expect.objectContaining({ reason: 'bad_class_code' }) }));
    // The code is compared case-insensitively (trim + uppercase).
    expect(prisma.liveClass.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'ABCDEF', state: 'ACTIVE' } }));
  });

  it('rejects with 409 when an ONLINE station already holds that system number', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.findUnique.mockResolvedValue({ id: 'other-station' });
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    await expect(
      service.claim('station1', dto, { isStationOnline: (id) => id === 'other-station' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.station.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.claim_failed', detail: expect.objectContaining({ reason: 'seat_in_use' }) }));
  });

  it('moves an OFFLINE station off the seat rather than blocking the sign-in', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.findUnique.mockResolvedValue({ id: 'stale-station' });
    prisma.station.update.mockResolvedValue({});
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    const result = await service.claim('station1', dto, { isStationOnline: () => false });

    expect(result.movedFromStationId).toBe('stale-station');
    expect(result.seatNo).toBe(6); // systemNumber 5 -> seatNo 6 (seat 1 reserved for the teacher)
    expect(prisma.station.update).toHaveBeenCalledWith({ where: { id: 'stale-station' }, data: { seatNo: null } });
    expect(prisma.station.update).toHaveBeenCalledWith({
      where: { id: 'station1' },
      data: expect.objectContaining({ seatNo: 6, currentUserId: 'stu1', liveClassId: 'class1' }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'stale-station', action: 'station.seat_moved' }));
  });

  it('turns a P2002 race on Station.seatNo into the same friendly 409', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    // No holder found by the pre-check (a concurrent claim for the same
    // seat is still in flight) — the DB's own unique constraint is what
    // actually catches it, on the update below.
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockRejectedValue(p2002(['seatNo']));
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    await expect(service.claim('station1', dto, { isStationOnline: () => false })).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.claim_failed', detail: expect.objectContaining({ reason: 'seat_in_use' }) }));
  });

  it('a P2002 on a different unique field (currentUserId) still reads as "already claimed"', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockRejectedValue(p2002(['currentUserId']));
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    await expect(service.claim('station1', dto, { isStationOnline: () => false })).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.claim_failed', detail: expect.objectContaining({ reason: 'already_claimed' }) }));
  });
});

describe('StationsService.claim — signing in without a class', () => {
  const noCodeDto = { serviceNumber: 'STU-001', password: 'secret123', systemNumber: 5 };

  it('with no enrollment, no classCode: no class lookup beyond the enrollment check, liveClassId stays null', async () => {
    const prisma = makeFakePrisma();
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockResolvedValue({});
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    const result = await service.claim('station1', noCodeDto, { isStationOnline: () => false });

    expect(prisma.enrollment.findMany).toHaveBeenCalledWith({ where: { userId: 'stu1' }, select: { batchId: true } });
    expect(prisma.liveClass.findFirst).not.toHaveBeenCalled(); // no enrollment at all — nothing to match against
    expect(result.liveClass).toBeNull();
    expect(result.studentToken).toBe('student-jwt');
    expect(prisma.station.update).toHaveBeenCalledWith({
      where: { id: 'station1' },
      data: expect.objectContaining({ seatNo: 6, currentUserId: 'stu1', liveClassId: null }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.claim', detail: expect.objectContaining({ liveClassId: null }) }));
  });

  it('returns the class summary (with the teacher name) when a valid classCode IS given', async () => {
    const prisma = makeFakePrisma();
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockResolvedValue({});
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    const result = await service.claim('station1', dto, { isStationOnline: () => false });

    expect(result.liveClass).toEqual({ id: 'class1', title: "Teacher's class", teacherId: 'teacher1', teacherName: 'Teacher One' });
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled(); // an explicit code always wins — no roster lookup needed
  });

  it('auto-joins a batch-scoped live class with no code, when one of the student’s enrolled classes has one ACTIVE', async () => {
    const prisma = makeFakePrisma({ enrollment: { findMany: vi.fn().mockResolvedValue([{ batchId: 'batch1' }, { batchId: 'batch2' }]) } });
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockResolvedValue({});
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    const result = await service.claim('station1', noCodeDto, { isStationOnline: () => false });

    expect(prisma.liveClass.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchId: { in: ['batch1', 'batch2'] }, state: 'ACTIVE' } }),
    );
    expect(result.liveClass).toEqual({ id: 'class1', title: "Teacher's class", teacherId: 'teacher1', teacherName: 'Teacher One' });
  });

  it('is enrolled but no matching class is live: stays unattached, not an error', async () => {
    const prisma = makeFakePrisma({ enrollment: { findMany: vi.fn().mockResolvedValue([{ batchId: 'batch1' }]) } });
    prisma.liveClass.findFirst.mockResolvedValue(null);
    prisma.station.findUnique.mockResolvedValue(null);
    prisma.station.update.mockResolvedValue({});
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    const result = await service.claim('station1', noCodeDto, { isStationOnline: () => false });

    expect(result.liveClass).toBeNull();
  });
});

describe('StationsService.attachToLiveClass', () => {
  it('refuses a station with nobody signed in', async () => {
    const prisma = makeFakePrisma();
    prisma.station.findUnique.mockResolvedValue({ currentUserId: null, seatNo: 6, liveClass: null });
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    await expect(service.attachToLiveClass('station1', 'ABCDEF')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.liveClass.findFirst).not.toHaveBeenCalled();
    expect(prisma.station.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown or ended class code, and audits the failure without attaching', async () => {
    const prisma = makeFakePrisma();
    prisma.station.findUnique.mockResolvedValue({ currentUserId: 'stu1', seatNo: 6, liveClass: null });
    prisma.liveClass.findFirst.mockResolvedValue(null);
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    await expect(service.attachToLiveClass('station1', 'zzzzzz')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.station.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'station.join_class_failed', detail: expect.objectContaining({ reason: 'bad_class_code', code: 'ZZZZZZ' }) }),
    );
  });

  it('attaches a signed-in seat, matching the code case-insensitively', async () => {
    const prisma = makeFakePrisma();
    prisma.station.findUnique.mockResolvedValue({ currentUserId: 'stu1', seatNo: 6, liveClass: null });
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.update.mockResolvedValue({});
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    const result = await service.attachToLiveClass('station1', '  abcdef ');

    expect(prisma.liveClass.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'ABCDEF', state: 'ACTIVE' } }));
    expect(prisma.station.update).toHaveBeenCalledWith({ where: { id: 'station1' }, data: { liveClassId: 'class1' } });
    expect(result).toEqual({
      seatNo: 6,
      liveClass: { id: 'class1', title: "Teacher's class", teacherId: 'teacher1', teacherName: 'Teacher One' },
      previousTeacherId: null,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'station.join_class', detail: { userId: 'stu1', liveClassId: 'class1' } }));
  });

  it('reports the previous class teacher when the seat moves between classes', async () => {
    const prisma = makeFakePrisma();
    prisma.station.findUnique.mockResolvedValue({ currentUserId: 'stu1', seatNo: 6, liveClass: { teacherId: 'teacher0' } });
    prisma.liveClass.findFirst.mockResolvedValue(liveClass);
    prisma.station.update.mockResolvedValue({});
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    const result = await service.attachToLiveClass('station1', 'ABCDEF');

    expect(result.previousTeacherId).toBe('teacher0');
  });
});

/**
 * Regression guard for a real bug caught by checking against the live dev
 * DB, not by reasoning about it: Prisma's `{ not: x }` on a NULLABLE column
 * compiles to `liveClassId != x`, which SQL's three-valued logic makes
 * UNKNOWN (excluded) wherever liveClassId IS NULL — i.e. for almost every
 * signed-in student, since most aren't in any class yet. The query must
 * OR in an explicit `liveClassId: null` arm, or "Start Live Class" would
 * silently skip everyone it exists to catch.
 */
describe('StationsService.attachEnrolledStudents', () => {
  it('includes a station with no class at all, not just ones in a DIFFERENT class', async () => {
    const prisma = makeFakePrisma({
      station: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'st1', seatNo: 3, currentUserId: 'stu1', liveClass: null }, // no class — the case the bug dropped
          { id: 'st2', seatNo: 4, currentUserId: 'stu2', liveClass: { teacherId: 'teacher0' } }, // a different class
        ]),
        updateMany: vi.fn(),
      },
    });
    const audit = makeFakeAudit();
    const service = makeService(prisma, audit, makeFakeAuth(student));

    const result = await service.attachEnrolledStudents('class1', ['stu1', 'stu2']);

    expect(prisma.station.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { currentUserId: { in: ['stu1', 'stu2'] }, OR: [{ liveClassId: null }, { liveClassId: { not: 'class1' } }] },
      }),
    );
    expect(prisma.station.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['st1', 'st2'] } }, data: { liveClassId: 'class1' } });
    expect(result).toEqual([
      { stationId: 'st1', seatNo: 3, previousTeacherId: null },
      { stationId: 'st2', seatNo: 4, previousTeacherId: 'teacher0' },
    ]);
  });

  it('does nothing for an empty roster', async () => {
    const prisma = makeFakePrisma();
    const service = makeService(prisma, makeFakeAudit(), makeFakeAuth(student));

    const result = await service.attachEnrolledStudents('class1', []);

    expect(result).toEqual([]);
    expect(prisma.station.findMany).not.toHaveBeenCalled();
  });
});
