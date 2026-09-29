import { describe, expect, it, vi } from 'vitest';
import { ActivityType } from '@lab/shared';
import { DictionaryPolicyService } from './dictionary-policy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    sessionMember: { findFirst: vi.fn().mockResolvedValue(null) },
    station: { findUnique: vi.fn().mockResolvedValue(null) },
    attempt: { findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function makeConfig(windowMin = 60): ConfigService<EnvConfig, true> {
  return { get: () => windowMin } as unknown as ConfigService<EnvConfig, true>;
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, windowMin = 60): DictionaryPolicyService {
  return new DictionaryPolicyService(prisma as unknown as PrismaService, makeConfig(windowMin));
}

describe('DictionaryPolicyService.assertAllowed', () => {
  it('never checks anything for a staff principal', async () => {
    const prisma = makeFakePrisma();
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'staff' })).resolves.toBeUndefined();
    expect(prisma.sessionMember.findFirst).not.toHaveBeenCalled();
  });

  it('allows a station with no live-session activity and no student signed in', async () => {
    const prisma = makeFakePrisma();
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).resolves.toBeUndefined();
  });

  it('blocks a station whose live VOCABULARY_TEST group has the dictionary off by default', async () => {
    const prisma = makeFakePrisma({
      sessionMember: {
        findFirst: vi.fn().mockResolvedValue({ group: { activity: { type: ActivityType.VOCABULARY_TEST, dictionaryEnabled: null } } }),
      },
    });
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DICTIONARY_DISABLED' }),
    });
  });

  it('allows a live VOCABULARY_TEST group when the teacher explicitly overrides it on', async () => {
    const prisma = makeFakePrisma({
      sessionMember: {
        findFirst: vi.fn().mockResolvedValue({ group: { activity: { type: ActivityType.VOCABULARY_TEST, dictionaryEnabled: true } } }),
      },
    });
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).resolves.toBeUndefined();
  });

  it('allows a live ROUND_TABLE group by default (dictionary on unless overridden)', async () => {
    const prisma = makeFakePrisma({
      sessionMember: {
        findFirst: vi.fn().mockResolvedValue({ group: { activity: { type: ActivityType.ROUND_TABLE, dictionaryEnabled: null } } }),
      },
    });
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).resolves.toBeUndefined();
  });

  it('blocks a station whose signed-in student has a fresh IN_PROGRESS vocabulary test attempt', async () => {
    const prisma = makeFakePrisma({
      station: { findUnique: vi.fn().mockResolvedValue({ currentUserId: 'stu1' }) },
      attempt: {
        findFirst: vi.fn().mockResolvedValue({ exercise: { type: ActivityType.VOCABULARY_TEST, dictionaryEnabled: null } }),
      },
    });
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DICTIONARY_DISABLED' }),
    });
  });

  it('queries an untimed attempt only within the configured window (no closesAt to check instead)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makeFakePrisma({ station: { findUnique: vi.fn().mockResolvedValue({ currentUserId: 'stu1' }) }, attempt: { findFirst } });
    const service = makeService(prisma, 30);
    await service.assertAllowed({ kind: 'station', stationId: 'st1' });
    const callArg = findFirst.mock.calls[0]![0];
    expect(callArg.where.studentId).toBe('stu1');
    const windowBranch = callArg.where.OR.find((c: { closesAt: unknown }) => c.closesAt === null);
    expect(windowBranch.startedAt.gte).toBeInstanceOf(Date);
  });

  it('SPEC-mcq-test-timed-reveal.md: a real timed test still blocks the dictionary past the configured window, as long as its own closesAt has not passed', async () => {
    const findFirst = vi.fn().mockResolvedValue({ exercise: { type: ActivityType.VOCABULARY_TEST, dictionaryEnabled: null } });
    const prisma = makeFakePrisma({ station: { findUnique: vi.fn().mockResolvedValue({ currentUserId: 'stu1' }) }, attempt: { findFirst } });
    // A short configured window (5 min) — a real 90-minute timed test must
    // not slip through it just because it has been running longer than 5
    // minutes. The fake doesn't actually filter by the query (it always
    // returns the attempt), so this asserts the QUERY ITSELF offers a
    // closesAt-based branch that doesn't depend on the window at all.
    const service = makeService(prisma, 5);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DICTIONARY_DISABLED' }),
    });
    const callArg = findFirst.mock.calls[0]![0];
    const closesAtBranch = callArg.where.OR.find((c: { closesAt?: unknown }) => c.closesAt && typeof c.closesAt === 'object' && 'gt' in c.closesAt);
    expect(closesAtBranch).toBeDefined();
  });

  it('allows a station whose seat has nobody signed in', async () => {
    const prisma = makeFakePrisma({ station: { findUnique: vi.fn().mockResolvedValue({ currentUserId: null }) } });
    const service = makeService(prisma);
    await expect(service.assertAllowed({ kind: 'station', stationId: 'st1' })).resolves.toBeUndefined();
    expect(prisma.attempt.findFirst).not.toHaveBeenCalled();
  });

  it('caches an allow/deny verdict briefly rather than re-querying every call', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = makeFakePrisma({ sessionMember: { findFirst } });
    const service = makeService(prisma);
    await service.assertAllowed({ kind: 'station', stationId: 'st1' });
    await service.assertAllowed({ kind: 'station', stationId: 'st1' });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
