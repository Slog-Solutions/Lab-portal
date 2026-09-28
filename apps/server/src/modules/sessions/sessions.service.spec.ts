import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CreateSessionDto } from '@lab/shared';
import { SessionsService } from './sessions.service';
import type { JwtPayload } from '../auth/auth.service';

const ADMIN: JwtPayload = { sub: 'admin1', role: 'ADMIN', serviceNumber: 'ADM-1' };
const BATCH = 'clh3am1r30000qzrmn831b01';
const ST_A = 'clh3am1r30000qzrmn831s0a';
const ST_B = 'clh3am1r30000qzrmn831s0b';

function makeRig(seated: Array<{ id: string; seatNo: number; currentUserId: string | null }>) {
  const prisma = {
    station: { findMany: vi.fn().mockResolvedValue(seated) },
    enrollment: { count: vi.fn().mockResolvedValue(0) },
    classSession: {
      create: vi.fn().mockImplementation(async (args: unknown) => args),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    sessionMember: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    activityInstance: { updateMany: vi.fn() },
  };
  const svc = new SessionsService(
    prisma as never,
    { ensureBroadcastRoom: vi.fn(), ensureRoom: vi.fn(), deleteRoom: vi.fn() } as never,
    { getDesiredState: vi.fn().mockResolvedValue({}) } as never,
    { pushSnapshot: vi.fn() } as never,
    { log: vi.fn() } as never,
    { assertCanUseBatch: vi.fn() } as never,
    {} as never,
    { filterControllable: vi.fn() } as never,
    { prepareOnArm: vi.fn(), onSessionState: vi.fn() } as never,
  );
  return { svc, prisma };
}

const dto = (over: Partial<CreateSessionDto> = {}): CreateSessionDto => ({
  title: 'Practice',
  batchId: BATCH,
  groups: [{ index: 1, activityType: 'TELEPHONE', activityConfig: {}, memberStationIds: [ST_A, ST_B] }],
  ...over,
});

type CreateArgs = { data: { groups: { create: Array<{ members: { create: Array<{ stationId: string; studentId: string | null }> } }> } } };

describe('SessionsService.create — who is in each group', () => {
  it('stamps each member with the student signed in at that seat (null for an empty seat)', async () => {
    const { svc, prisma } = makeRig([
      { id: ST_A, seatNo: 4, currentUserId: 'stu-a' },
      { id: ST_B, seatNo: 5, currentUserId: null },
    ]);
    await svc.create(dto(), ADMIN);

    const args = prisma.classSession.create.mock.calls[0]![0] as CreateArgs;
    expect(args.data.groups.create[0]!.members.create).toEqual([
      expect.objectContaining({ stationId: ST_A, studentId: 'stu-a' }),
      expect.objectContaining({ stationId: ST_B, studentId: null }),
    ]);
  });

  it('accepts student picks that still match the seats and are all in the class', async () => {
    const { svc, prisma } = makeRig([
      { id: ST_A, seatNo: 4, currentUserId: 'stu-a' },
      { id: ST_B, seatNo: 5, currentUserId: 'stu-b' },
    ]);
    prisma.enrollment.count.mockResolvedValue(2);
    await svc.create(dto({ expectedStudents: { [ST_A]: 'stu-a', [ST_B]: 'stu-b' } }), ADMIN);

    expect(prisma.enrollment.count).toHaveBeenCalledWith({ where: { batchId: BATCH, userId: { in: ['stu-a', 'stu-b'] } } });
    expect(prisma.classSession.create).toHaveBeenCalled();
  });

  it('refuses with 409 when someone else now sits at a picked seat', async () => {
    const { svc, prisma } = makeRig([
      { id: ST_A, seatNo: 4, currentUserId: 'stu-someone-else' },
      { id: ST_B, seatNo: 5, currentUserId: 'stu-b' },
    ]);
    await expect(svc.create(dto({ expectedStudents: { [ST_A]: 'stu-a' } }), ADMIN)).rejects.toThrow(ConflictException);
    await expect(svc.create(dto({ expectedStudents: { [ST_A]: 'stu-a' } }), ADMIN)).rejects.toThrow(/System 3/);
    expect(prisma.classSession.create).not.toHaveBeenCalled();
  });

  it('refuses a picked student who is not in the class', async () => {
    const { svc, prisma } = makeRig([
      { id: ST_A, seatNo: 4, currentUserId: 'stu-a' },
      { id: ST_B, seatNo: 5, currentUserId: 'stu-b' },
    ]);
    prisma.enrollment.count.mockResolvedValue(1);
    await expect(svc.create(dto({ expectedStudents: { [ST_A]: 'stu-a', [ST_B]: 'stu-b' } }), ADMIN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.classSession.create).not.toHaveBeenCalled();
  });

  it('refuses a pick for a seat that is in no group', async () => {
    const { svc } = makeRig([{ id: ST_A, seatNo: 4, currentUserId: 'stu-a' }]);
    const groups = [{ index: 1, activityType: 'TELEPHONE' as const, activityConfig: {}, memberStationIds: [ST_A] }];
    await expect(svc.create(dto({ groups, expectedStudents: { [ST_B]: 'stu-b' } }), ADMIN)).rejects.toThrow(/not in any group/);
  });
});

describe('SessionsService arm/start — re-stamping who does the activity', () => {
  const session = (state: string) => ({ id: 's1', batchId: BATCH, state, groups: [] });

  it('arm re-stamps every member seat that has someone signed in, and leaves empty seats alone', async () => {
    const { svc, prisma } = makeRig([]);
    prisma.classSession.findUnique.mockResolvedValue(session('DRAFT'));
    prisma.sessionMember.findMany.mockResolvedValue([
      { id: 'm1', studentId: 'stu-old', station: { currentUserId: 'stu-new' } },
      { id: 'm2', studentId: 'stu-same', station: { currentUserId: 'stu-same' } },
      { id: 'm3', studentId: 'stu-kept', station: { currentUserId: null } },
    ]);
    await svc.arm('s1', ADMIN);

    expect(prisma.sessionMember.findMany.mock.calls[0]![0].where).toEqual({ group: { sessionId: 's1' } });
    expect(prisma.sessionMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.sessionMember.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { studentId: 'stu-new' } });
  });

  it('start only fills members that are still unattributed', async () => {
    const { svc, prisma } = makeRig([]);
    prisma.classSession.findUnique.mockResolvedValue(session('ARMED'));
    prisma.sessionMember.findMany.mockResolvedValue([{ id: 'm1', studentId: null, station: { currentUserId: 'stu-late' } }]);
    await svc.start('s1', ADMIN);

    expect(prisma.sessionMember.findMany.mock.calls[0]![0].where).toEqual({ group: { sessionId: 's1' }, studentId: null });
    expect(prisma.sessionMember.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { studentId: 'stu-late' } });
  });
});
