import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@lab/shared';
import { ClassAccessService } from './class-access.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    liveClass: { findFirst: vi.fn() },
    station: { findMany: vi.fn() },
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma> = makeFakePrisma()): ClassAccessService {
  return new ClassAccessService(prisma as unknown as PrismaService);
}

const teacher = { sub: 'teacher1', role: UserRole.TEACHER };
const admin = { sub: 'admin1', role: UserRole.ADMIN };

/**
 * Regression guard for the "teacher-wide remote control" decision
 * (2026-09-18): a TEACHER now controls every lab PC, always — no active
 * class required, and no per-station DB lookup needed to answer that.
 */
describe('ClassAccessService — teacher-wide control scope', () => {
  it('controllableStationIds resolves \'all\' for a TEACHER with no query to the database', async () => {
    const prisma = makeFakePrisma();
    const service = makeService(prisma);

    const result = await service.controllableStationIds(teacher);

    expect(result).toBe('all');
    expect(prisma.station.findMany).not.toHaveBeenCalled();
  });

  it('controllableStationIds resolves \'all\' for an ADMIN too', async () => {
    const service = makeService();
    expect(await service.controllableStationIds(admin)).toBe('all');
  });

  it('assertCanControlStation no longer throws for a station with no liveClassId', async () => {
    const service = makeService();
    await expect(service.assertCanControlStation(teacher, 'idle-station-no-class')).resolves.toBeUndefined();
  });

  it('filterControllable returns every requested id unfiltered for a TEACHER', async () => {
    const service = makeService();
    const ids = ['st1', 'st2', 'st3'];
    expect(await service.filterControllable(teacher, ids)).toEqual(ids);
  });

  it('activeClassForTeacher is untouched — still scoped to that teacher\'s own ACTIVE class, for media/spotlight', async () => {
    const prisma = makeFakePrisma({
      liveClass: { findFirst: vi.fn().mockResolvedValue({ id: 'class1', teacherId: 'teacher1', state: 'ACTIVE' }) },
    });
    const service = makeService(prisma);

    const result = await service.activeClassForTeacher('teacher1');

    expect(result).toEqual({ id: 'class1', teacherId: 'teacher1', state: 'ACTIVE' });
    expect(prisma.liveClass.findFirst).toHaveBeenCalledWith({ where: { teacherId: 'teacher1', state: 'ACTIVE' } });
  });
});
