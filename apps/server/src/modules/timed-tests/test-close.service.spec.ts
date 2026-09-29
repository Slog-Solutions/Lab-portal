import { describe, expect, it, vi } from 'vitest';
import { AttemptStatus } from '@lab/shared';
import { TestCloseService } from './test-close.service';
import { TestClockService } from './test-clock.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AttemptsService } from '../attempts/attempts.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { ControlGateway } from '../control/control.gateway';

/**
 * A minimal in-memory Prisma fake for ActivityInstance/Attempt, shared by
 * the REAL TestClockService (not a mock of it) — doFinalize reads state
 * TestClockService.claimClose just wrote, and a naive claimClose mock
 * can't stay consistent with that read on its own the way this store does.
 */
function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Array<Record<string, unknown>>).some((c) => matchWhere(row, c))) return false;
      continue;
    }
    const val = row[key];
    if (cond === null) {
      if (val !== null) return false;
      continue;
    }
    if (cond && typeof cond === 'object') {
      const c = cond as Record<string, unknown>;
      if ('not' in c) {
        if (c.not === null ? val === null : val === c.not) return false;
        continue;
      }
      if ('gt' in c) {
        if (!((val as Date) > (c.gt as Date))) return false;
        continue;
      }
      if ('lte' in c) {
        if (!((val as Date) <= (c.lte as Date))) return false;
        continue;
      }
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

function makeFakePrisma() {
  const instances = new Map<string, Record<string, unknown>>();
  const attempts = new Map<string, Record<string, unknown>>();

  const activityInstance = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => instances.get(where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...instances.values()].filter((r) => matchWhere(r, where)).map((r) => ({ id: r.id as string })),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of instances.values()) {
        if (matchWhere(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    }),
  };

  const attempt = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...attempts.values()].filter((r) => matchWhere(r, where))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of attempts.values()) {
        if (matchWhere(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    }),
  };

  return { instances, attempts, activityInstance, attempt };
}

function makeRig() {
  const prisma = makeFakePrisma();
  const testClock = new TestClockService(prisma as unknown as PrismaService);
  const attempts = { autoSubmitExpired: vi.fn().mockResolvedValue(true) };
  const sessions = { republish: vi.fn().mockResolvedValue(undefined) };
  const gateway = { emitToGroup: vi.fn() };
  const service = new TestCloseService(
    prisma as unknown as PrismaService,
    attempts as unknown as AttemptsService,
    sessions as unknown as SessionsService,
    gateway as unknown as ControlGateway,
    testClock,
  );
  return { service, prisma, attempts, sessions, gateway };
}

/** An ON_TIME_EXPIRY instance with one already-SCORED attempt whose own
 * revealAt was pre-set to its (future) individual closesAt — exactly what
 * AttemptsService.finalizeVocabAttempt does at submit time for this mode.
 * This is the shape that exposed both bugs below. */
function seedTimedInstance(prisma: ReturnType<typeof makeFakePrisma>, opts: { revealMode: string; futureRevealAt?: boolean; closesAtPast?: boolean }) {
  const now = Date.now();
  const future = new Date(now + 5 * 60_000);
  const past = new Date(now - 1000);
  prisma.instances.set('inst1', {
    id: 'inst1',
    groupId: 'grp1',
    exerciseId: 'ex1',
    closedAt: null,
    closeKind: null,
    revealedAt: null,
    finalizedAt: null,
    closesAt: opts.closesAtPast ? past : future,
    exercise: { config: { timeLimitSec: 600, revealMode: opts.revealMode } },
    group: { sessionId: 'sess1' },
  });
  prisma.attempts.set('att1', {
    id: 'att1',
    activityInstanceId: 'inst1',
    status: AttemptStatus.SCORED,
    revealAt: opts.futureRevealAt === false ? null : future,
  });
  return { future, past };
}

describe('TestCloseService.finalizeInstance — reveal semantics (regression: live e2e caught both of these)', () => {
  it('"Reveal now" reveals an attempt whose own revealAt was already set to a FUTURE timestamp (ON_TIME_EXPIRY submitted early)', async () => {
    const { service, prisma, sessions, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', futureRevealAt: true });

    await service.finalizeInstance('inst1', 'REVEAL_NOW');

    const attempt = prisma.attempts.get('att1')!;
    expect((attempt.revealAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    expect(prisma.instances.get('inst1')!.revealedAt).not.toBeNull();
    expect(gateway.emitToGroup).toHaveBeenCalledWith('grp1', 'test:revealed', { activityInstanceId: 'inst1' });
    expect(sessions.republish).toHaveBeenCalledWith('sess1');
  });

  it('"Close without reveal" clears a future revealAt back to null, so it can never silently arrive on its own later', async () => {
    const { service, prisma, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', futureRevealAt: true });

    await service.finalizeInstance('inst1', 'NO_REVEAL');

    expect(prisma.attempts.get('att1')!.revealAt).toBeNull();
    expect(prisma.instances.get('inst1')!.revealedAt).toBeNull();
    expect(gateway.emitToGroup).not.toHaveBeenCalledWith('grp1', 'test:revealed', expect.anything());
  });

  it('release() actually reveals an ON_TEACHER_RELEASE test (it must not be excluded by its own policy check)', async () => {
    const { service, prisma, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TEACHER_RELEASE', futureRevealAt: false });

    await service.release('inst1');

    expect(prisma.attempts.get('att1')!.revealAt).not.toBeNull();
    expect(gateway.emitToGroup).toHaveBeenCalledWith('grp1', 'test:revealed', { activityInstanceId: 'inst1' });
  });

  it('a natural EXPIRED close does NOT auto-reveal an ON_TEACHER_RELEASE test ("never automatic")', async () => {
    const { service, prisma, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TEACHER_RELEASE', futureRevealAt: false, closesAtPast: true });

    await service.finalizeInstance('inst1', 'EXPIRED');

    expect(prisma.attempts.get('att1')!.revealAt).toBeNull();
    expect(prisma.instances.get('inst1')!.finalizedAt).not.toBeNull(); // still finalized — just not revealed
    expect(gateway.emitToGroup).not.toHaveBeenCalledWith('grp1', 'test:revealed', expect.anything());
  });

  it('a natural EXPIRED close DOES reveal an ON_TIME_EXPIRY test', async () => {
    const { service, prisma, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', futureRevealAt: true, closesAtPast: true });

    await service.finalizeInstance('inst1', 'EXPIRED');

    expect(prisma.attempts.get('att1')!.revealAt).not.toBeNull();
    expect(gateway.emitToGroup).toHaveBeenCalledWith('grp1', 'test:revealed', { activityInstanceId: 'inst1' });
  });

  it('auto-submits every still-open attempt before revealing', async () => {
    const { service, prisma, attempts } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', closesAtPast: true });
    prisma.attempts.set('att2', { id: 'att2', activityInstanceId: 'inst1', status: AttemptStatus.IN_PROGRESS, revealAt: null });

    await service.finalizeInstance('inst1', 'EXPIRED');

    expect(attempts.autoSubmitExpired).toHaveBeenCalledWith('att2');
  });

  it('idempotency: two concurrent calls for the same instance push exactly once (in-process dedup)', async () => {
    const { service, prisma, sessions, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', futureRevealAt: true });

    await Promise.all([service.finalizeInstance('inst1', 'REVEAL_NOW'), service.finalizeInstance('inst1', 'REVEAL_NOW')]);

    expect(sessions.republish).toHaveBeenCalledTimes(1);
    expect(gateway.emitToGroup).toHaveBeenCalledTimes(1);
  });

  it('idempotency: a second, independent call after the first fully finished is a no-op (crash/retry safe)', async () => {
    const { service, prisma, sessions, gateway } = makeRig();
    seedTimedInstance(prisma, { revealMode: 'ON_TIME_EXPIRY', futureRevealAt: true });

    await service.finalizeInstance('inst1', 'REVEAL_NOW');
    sessions.republish.mockClear();
    gateway.emitToGroup.mockClear();
    await service.finalizeInstance('inst1', 'REVEAL_NOW');

    expect(sessions.republish).not.toHaveBeenCalled();
    expect(gateway.emitToGroup).not.toHaveBeenCalled();
  });

  it('does nothing for an instance with no linked exercise (not a real timed test)', async () => {
    const { service, prisma, sessions } = makeRig();
    prisma.instances.set('inst2', { id: 'inst2', groupId: 'g', exerciseId: null, exercise: null, closedAt: null, finalizedAt: null, closeKind: null });

    await service.finalizeInstance('inst2', 'EXPIRED');

    expect(sessions.republish).not.toHaveBeenCalled();
  });
});
