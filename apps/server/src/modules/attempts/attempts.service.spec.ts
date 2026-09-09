import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityType, AttemptStatus } from '@lab/shared';
import { AttemptsService } from './attempts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/**
 * Ser 5/10's actual grading authority (this file's own doc comment: "a
 * randomized test-bank attempt can only be graded against the DB"). No
 * real Postgres here — a fake PrismaService is enough to exercise the
 * real scoring logic (`scoreVocabularyTest`, private) through the same
 * public `submit()` path a real request takes, which is both more
 * honest about what's actually being tested and avoids reaching into
 * private internals the way word-list-parser.ts's exported pure function
 * doesn't need to.
 *
 * Typed as a plain mock object here (not `PrismaService` — that would
 * hide the `.mockResolvedValue`/`.mockImplementation` methods these tests
 * actually call) and cast only at the `new AttemptsService(...)` call
 * site, where the real constructor type is what should be checked.
 */
function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    exercise: { findUnique: vi.fn() },
    attempt: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    itemBank: { findUnique: vi.fn() },
    item: { findMany: vi.fn() },
    itemResponse: { createMany: vi.fn() },
    skillProgress: { create: vi.fn() },
    ...overrides,
  };
}

function makeFakeAudit() {
  return { log: vi.fn() };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, audit: ReturnType<typeof makeFakeAudit>): AttemptsService {
  return new AttemptsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
}

describe('AttemptsService — inline-mode vocabulary test scoring', () => {
  const exercise = {
    id: 'ex1',
    type: ActivityType.VOCABULARY_TEST,
    config: {
      shuffleItems: false,
      items: [
        { prompt: 'cat', answer: 'gato' },
        { prompt: 'dog', answer: 'Perro' }, // mixed case on purpose
      ],
    },
  };

  it('start() strips the answer key from served items (Phase 3\'s own real security bug, regression-guarded)', async () => {
    const prisma = makeFakePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise);
    prisma.attempt.create.mockResolvedValue({ id: 'att1' });
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.start('student1', { exerciseId: 'ex1' });

    expect(result.items).toEqual([
      { id: 'inline:0', prompt: 'cat', choices: [] },
      { id: 'inline:1', prompt: 'dog', choices: [] },
    ]);
    for (const item of result.items!) {
      expect(item).not.toHaveProperty('answer');
    }
  });

  it('grades 100% when every answer matches (case/whitespace-insensitive)', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      itemOrder: ['inline:0', 'inline:1'],
      status: AttemptStatus.IN_PROGRESS,
      exercise,
    });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [
        { itemId: 'inline:0', given: '  Gato  ' }, // whitespace + case differ, should still match
        { itemId: 'inline:1', given: 'perro' },
      ],
    });

    expect(result).toMatchObject({ rawScore: 100, status: AttemptStatus.SCORED });
  });

  it('grades partial credit and records SkillProgress for a SCORED attempt', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      status: AttemptStatus.IN_PROGRESS,
      itemOrder: ['inline:0', 'inline:1'],
      exercise,
    });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [
        { itemId: 'inline:0', given: 'gato' }, // correct
        { itemId: 'inline:1', given: 'wrong' }, // incorrect
      ],
    });

    expect(result).toMatchObject({ rawScore: 50, status: AttemptStatus.SCORED });
    expect(prisma.skillProgress.create).toHaveBeenCalledWith({
      data: { studentId: 'student1', skill: 'vocabulary', score: expect.any(Number) },
    });
  });

  it('never persists ItemResponse rows for inline items (they have no real Item row to point the FK at)', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'student1', status: AttemptStatus.IN_PROGRESS, itemOrder: ['inline:0', 'inline:1'], exercise });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [{ itemId: 'inline:0', given: 'gato' }],
    });

    expect(prisma.itemResponse.createMany).not.toHaveBeenCalled();
  });

  it('rejects submitting an attempt that belongs to a different student', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'someone-else', itemOrder: [], exercise });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.submit('att1', 'student1', { response: {} })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects submitting an already-submitted attempt', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      status: AttemptStatus.SCORED,
      itemOrder: [],
      exercise,
    });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.submit('att1', 'student1', { response: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects starting a live-session-only activity type (e.g. ROUND_TABLE) through this endpoint', async () => {
    const prisma = makeFakePrisma();
    prisma.exercise.findUnique.mockResolvedValue({ id: 'ex2', type: ActivityType.ROUND_TABLE, config: {} });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.start('student1', { exerciseId: 'ex2' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
