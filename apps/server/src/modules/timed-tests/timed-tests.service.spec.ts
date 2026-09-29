import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TimedTestsService } from './timed-tests.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { BatchAccessService } from '../batches/batch-access.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { ControlGateway } from '../control/control.gateway';
import type { TestCloseService } from './test-close.service';
import type { JwtPayload } from '../auth/auth.service';

const TEACHER: JwtPayload = { sub: 'teacher1', role: 'TEACHER', serviceNumber: 'TCH-1' };
const OTHER_TEACHER: JwtPayload = { sub: 'teacher2', role: 'TEACHER', serviceNumber: 'TCH-2' };
const ADMIN: JwtPayload = { sub: 'admin1', role: 'ADMIN', serviceNumber: 'ADM-1' };

function makeRig(overrides: { exercise?: Record<string, unknown>; busy?: Array<{ station: { seatNo: number } }> } = {}) {
  const exercise = overrides.exercise ?? { id: 'ex1', type: 'VOCABULARY_TEST', teacherId: 'teacher1', title: 'T', config: {}, dictionaryEnabled: null };
  const prisma = {
    exercise: { findUnique: vi.fn().mockResolvedValue(exercise) },
    sessionMember: { findMany: vi.fn().mockResolvedValue(overrides.busy ?? []) },
    activityInstance: { findUnique: vi.fn(), updateMany: vi.fn() },
    attempt: { updateMany: vi.fn() },
  };
  const audit = { log: vi.fn() };
  const batchAccess = { assertCanUseBatch: vi.fn().mockResolvedValue(undefined) };
  const sessions = {
    create: vi.fn().mockResolvedValue({ id: 'sess1' }),
    arm: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ groups: [{ activity: { id: 'inst1' } }] }),
    republish: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = { emitToGroup: vi.fn() };
  const testClose = { finalizeInstance: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
  const service = new TimedTestsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    batchAccess as unknown as BatchAccessService,
    sessions as unknown as SessionsService,
    gateway as unknown as ControlGateway,
    testClose as unknown as TestCloseService,
  );
  return { service, prisma, audit, batchAccess, sessions, gateway, testClose };
}

describe('TimedTestsService.launch', () => {
  it('refuses a non-VOCABULARY_TEST exercise', async () => {
    const { service } = makeRig({ exercise: { id: 'ex1', type: 'READING_TEST', teacherId: 'teacher1', config: {} } });
    await expect(service.launch(TEACHER, { exerciseId: 'ex1', batchId: 'b1', expectedStudents: { st1: 'stu1' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("refuses a teacher who doesn't own the exercise (admin is still fine)", async () => {
    const { service, sessions } = makeRig();
    await expect(service.launch(OTHER_TEACHER, { exerciseId: 'ex1', batchId: 'b1', expectedStudents: { st1: 'stu1' } })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sessions.create).not.toHaveBeenCalled();

    await expect(service.launch(ADMIN, { exerciseId: 'ex1', batchId: 'b1', expectedStudents: { st1: 'stu1' } })).resolves.toMatchObject({
      sessionId: 'sess1',
    });
  });

  it('refuses seats already busy in another live session, naming them, and creates nothing', async () => {
    const { service, sessions } = makeRig({ busy: [{ station: { seatNo: 5 } }] });
    await expect(service.launch(TEACHER, { exerciseId: 'ex1', batchId: 'b1', expectedStudents: { st1: 'stu1' } })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('links the launched session back to the exercise and returns its instance id', async () => {
    const { service, sessions } = makeRig();
    const result = await service.launch(TEACHER, { exerciseId: 'ex1', batchId: 'b1', expectedStudents: { st1: 'stu1' } });

    expect(sessions.create).toHaveBeenCalledWith(expect.any(Object), TEACHER, { exerciseIdByGroupIndex: { 1: 'ex1' } });
    expect(sessions.arm).toHaveBeenCalledWith('sess1', TEACHER);
    expect(sessions.start).toHaveBeenCalledWith('sess1', TEACHER);
    expect(result).toEqual({ sessionId: 'sess1', activityInstanceId: 'inst1' });
  });
});

describe('TimedTestsService.extend', () => {
  function withInstance(prisma: ReturnType<typeof makeRig>['prisma'], over: Record<string, unknown> = {}) {
    prisma.activityInstance.findUnique.mockResolvedValue({
      id: 'inst1',
      groupId: 'grp1',
      exerciseId: 'ex1',
      closesAt: new Date(Date.now() + 60_000),
      closedAt: null,
      revealedAt: null,
      exercise: { title: 'T' },
      group: { sessionId: 'sess1', session: { batchId: 'b1', state: 'RUNNING' } },
      ...over,
    });
  }

  it('refuses to extend an untimed test', async () => {
    const { service, prisma } = makeRig();
    withInstance(prisma, { closesAt: null });
    await expect(service.extend(TEACHER, 'inst1', 60)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to extend an already-closed test', async () => {
    const { service, prisma } = makeRig();
    withInstance(prisma, { closedAt: new Date() });
    await expect(service.extend(TEACHER, 'inst1', 60)).rejects.toBeInstanceOf(ConflictException);
  });

  it('pushes a fresh snapshot and emits test:closing on a successful extend', async () => {
    const { service, prisma, sessions, gateway } = makeRig();
    withInstance(prisma);
    prisma.activityInstance.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.extend(TEACHER, 'inst1', 60);

    expect(result.ok).toBe(true);
    expect(sessions.republish).toHaveBeenCalledWith('sess1');
    expect(gateway.emitToGroup).toHaveBeenCalledWith('grp1', 'test:closing', expect.objectContaining({ activityInstanceId: 'inst1' }));
  });

  it('a lost optimistic race (closesAt changed underneath it) is rejected with 409, not silently wrong', async () => {
    const { service, prisma } = makeRig();
    withInstance(prisma);
    prisma.activityInstance.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.extend(TEACHER, 'inst1', 60)).rejects.toBeInstanceOf(ConflictException);
  });
});
