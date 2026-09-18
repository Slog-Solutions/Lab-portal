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
  const station = { findUnique: vi.fn(), update: vi.fn() };
  return {
    station,
    liveClass: { findFirst: vi.fn() },
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
