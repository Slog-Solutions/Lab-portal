import { describe, expect, it, vi } from 'vitest';
import { DictionaryLogService } from './dictionary-log.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    dictionaryLookup: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function makeConfig(retentionDays = 90): ConfigService<EnvConfig, true> {
  return { get: () => retentionDays } as unknown as ConfigService<EnvConfig, true>;
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, retentionDays = 90): DictionaryLogService {
  return new DictionaryLogService(prisma as unknown as PrismaService, makeConfig(retentionDays));
}

describe('DictionaryLogService.logLookup', () => {
  it('writes a row with the given fields', () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    svc.logLookup({ stationId: 'st1', word: 'run', resolvedHeadword: 'run', found: true });
    expect(prisma.dictionaryLookup.create).toHaveBeenCalledWith({
      data: { stationId: 'st1', word: 'run', resolvedHeadword: 'run', found: true },
    });
  });

  it('never throws when the write fails (fire-and-forget)', async () => {
    const prisma = makeFakePrisma({ dictionaryLookup: { create: vi.fn().mockRejectedValue(new Error('db down')) } });
    const svc = makeService(prisma);
    expect(() => svc.logLookup({ stationId: 'st1', word: 'run', resolvedHeadword: null, found: false })).not.toThrow();
    // Let the rejected promise's .catch() run before the test ends, so a
    // regression that drops the .catch() shows up as an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('DictionaryLogService.purgeExpired', () => {
  it('deletes rows older than the configured retention window', async () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma, 30);
    const before = Date.now();
    await svc.purgeExpired();
    const call = prisma.dictionaryLookup.deleteMany.mock.calls[0]![0];
    const cutoff = call.where.at.lt as Date;
    const expectedCutoff = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it('returns the number of rows purged', async () => {
    const prisma = makeFakePrisma({ dictionaryLookup: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) } });
    const svc = makeService(prisma);
    expect(await svc.purgeExpired()).toBe(7);
  });
});

describe('DictionaryLogService.purgeAll', () => {
  it('deletes every row unconditionally', async () => {
    const prisma = makeFakePrisma({ dictionaryLookup: { deleteMany: vi.fn().mockResolvedValue({ count: 42 }) } });
    const svc = makeService(prisma);
    expect(await svc.purgeAll()).toBe(42);
    expect(prisma.dictionaryLookup.deleteMany).toHaveBeenCalledWith({});
  });
});

describe('DictionaryLogService.topWords', () => {
  it('groups by resolvedHeadword, excluding not-found lookups', async () => {
    const prisma = makeFakePrisma({
      dictionaryLookup: {
        groupBy: vi.fn().mockResolvedValue([
          { resolvedHeadword: 'run', _count: { resolvedHeadword: 5 } },
          { resolvedHeadword: 'mouse', _count: { resolvedHeadword: 2 } },
        ]),
      },
    });
    const svc = makeService(prisma);
    const rows = await svc.topWords(7, 50);
    expect(rows).toEqual([
      { word: 'run', count: 5 },
      { word: 'mouse', count: 2 },
    ]);
    const call = prisma.dictionaryLookup.groupBy.mock.calls[0]![0];
    expect(call.where.found).toBe(true);
    expect(call.where.resolvedHeadword).toEqual({ not: null });
    expect(call.take).toBe(50);
  });
});
