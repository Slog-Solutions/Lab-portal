import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivityType, AttemptStatus } from '@lab/shared';
import { PronunciationTestsService } from './pronunciation-tests.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { GradebookService } from '../gradebook/gradebook.service';

/** Plain mocks (not PrismaService-typed) so the .mock* helpers stay
 * callable — cast only at the constructor, same as attempts.service.spec.ts. */
function setup() {
  const prisma = {
    user: { findMany: vi.fn() },
    attempt: { findUnique: vi.fn() },
    itemResponse: { updateMany: vi.fn((args: object) => Promise.resolve(args)) },
    // Interactive form (create) runs the callback against a tx that is
    // the same fake; array form (grade) just resolves the queued calls.
    $transaction: vi.fn(),
  };
  const tx = {
    exercise: { create: vi.fn().mockResolvedValue({ id: 'ex1' }) },
    itemBank: { create: vi.fn().mockResolvedValue({ id: 'bank1' }) },
    item: { createMany: vi.fn() },
    assignment: { createMany: vi.fn() },
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]),
  );
  const audit = { log: vi.fn() };
  const gradebook = { override: vi.fn().mockResolvedValue({ id: 'ov1' }) };
  const service = new PronunciationTestsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    gradebook as unknown as GradebookService,
  );
  return { prisma, tx, audit, gradebook, service };
}

describe('PronunciationTestsService.create', () => {
  const dto = {
    title: 'Unit 3 drill',
    words: ['thorough', 'rural'],
    playModelAudio: true,
    voice: 'en_GB' as const,
    studentIds: ['s1', 's2'],
    instructions: undefined,
    dueAt: undefined,
  };

  it('creates the exercise, its words (in order) and one assignment per student', async () => {
    const { prisma, tx, audit, service } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

    const result = await service.create('teacher1', dto);

    expect(result).toEqual({ exerciseId: 'ex1', wordCount: 2, assigned: 2 });
    expect(tx.exercise.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teacherId: 'teacher1',
        type: ActivityType.PRONUNCIATION_TEST,
        title: 'Unit 3 drill',
        config: { playModelAudio: true, voice: 'en_GB' },
      }),
    });
    expect(tx.item.createMany).toHaveBeenCalledWith({
      data: [
        { itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: 'thorough', answer: 'thorough' },
        { itemBankId: 'bank1', order: 1, type: 'SHORT_ANSWER', prompt: 'rural', answer: 'rural' },
      ],
    });
    expect(tx.assignment.createMany).toHaveBeenCalledWith({
      data: [
        { teacherId: 'teacher1', studentId: 's1', exerciseId: 'ex1', dueAt: undefined },
        { teacherId: 'teacher1', studentId: 's2', exerciseId: 'ex1', dueAt: undefined },
      ],
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'pronunciation_test.create' }));
  });

  it('rejects student ids that are not active students, and creates nothing', async () => {
    const { prisma, tx, service } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 's1' }]); // s2 is unknown / inactive / not a STUDENT

    await expect(service.create('teacher1', dto)).rejects.toThrow(/Not active students: s2/);
    expect(tx.exercise.create).not.toHaveBeenCalled();
  });
});

describe('PronunciationTestsService.grade', () => {
  const submitted = {
    id: 'att1',
    status: AttemptStatus.SUBMITTED,
    itemOrder: ['w1', 'w2', 'w3'],
    exercise: { type: ActivityType.PRONUNCIATION_TEST },
  };

  it('scores the average rating as a percentage and delegates to the audited gradebook override', async () => {
    const { prisma, gradebook, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue(submitted);

    await service.grade('teacher1', 'att1', {
      ratings: [
        { itemId: 'w1', score: 5 },
        { itemId: 'w2', score: 4 },
        { itemId: 'w3', score: 3 },
      ],
    });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', {
      attemptId: 'att1',
      newScore: 80, // (5+4+3)/3 = 4.0 -> 80%
      reason: 'Per-word pronunciation ratings, average 4.0/5',
    });
  });

  it("rounds to a whole percent and prefers the teacher's own feedback as the reason", async () => {
    const { prisma, gradebook, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue(submitted);

    await service.grade('teacher1', 'att1', {
      ratings: [
        { itemId: 'w1', score: 5 },
        { itemId: 'w2', score: 5 },
        { itemId: 'w3', score: 4 },
      ],
      feedback: 'Watch the "r" in rural',
    });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', {
      attemptId: 'att1',
      newScore: 93, // 4.667/5 = 93.3%
      reason: 'Watch the "r" in rural',
    });
  });

  it("stores each word's rating on its ItemResponse, treating 3+ as correct", async () => {
    const { prisma, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue(submitted);

    await service.grade('teacher1', 'att1', {
      ratings: [
        { itemId: 'w1', score: 5 },
        { itemId: 'w2', score: 2 },
        { itemId: 'w3', score: 3 },
      ],
    });

    expect(prisma.itemResponse.updateMany).toHaveBeenCalledWith({ where: { attemptId: 'att1', itemId: 'w1' }, data: { score: 5, correct: true } });
    expect(prisma.itemResponse.updateMany).toHaveBeenCalledWith({ where: { attemptId: 'att1', itemId: 'w2' }, data: { score: 2, correct: false } });
    expect(prisma.itemResponse.updateMany).toHaveBeenCalledWith({ where: { attemptId: 'att1', itemId: 'w3' }, data: { score: 3, correct: true } });
  });

  it('refuses partial ratings without changing anything', async () => {
    const { prisma, gradebook, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue(submitted);

    await expect(service.grade('teacher1', 'att1', { ratings: [{ itemId: 'w1', score: 5 }] })).rejects.toThrow(/2 still unrated/);
    expect(prisma.itemResponse.updateMany).not.toHaveBeenCalled();
    expect(gradebook.override).not.toHaveBeenCalled();
  });

  it('refuses a rating for a word that is not in the test, and duplicate ratings', async () => {
    const { prisma, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue(submitted);
    const all = [
      { itemId: 'w1', score: 5 },
      { itemId: 'w2', score: 5 },
      { itemId: 'w3', score: 5 },
    ];

    await expect(service.grade('t', 'att1', { ratings: [...all, { itemId: 'nope', score: 1 }] })).rejects.toThrow(/not in this test/);
    await expect(service.grade('t', 'att1', { ratings: [...all, { itemId: 'w1', score: 1 }] })).rejects.toThrow(/more than once/);
  });

  it('refuses an attempt the student has not submitted, or one that is not a pronunciation test', async () => {
    const { prisma, service } = setup();
    const ratings = [{ itemId: 'w1', score: 5 }];

    prisma.attempt.findUnique.mockResolvedValue({ ...submitted, status: AttemptStatus.IN_PROGRESS });
    await expect(service.grade('t', 'att1', { ratings })).rejects.toThrow(/not submitted/);

    prisma.attempt.findUnique.mockResolvedValue({ ...submitted, exercise: { type: ActivityType.VOCABULARY_TEST } });
    await expect(service.grade('t', 'att1', { ratings })).rejects.toBeInstanceOf(BadRequestException);

    prisma.attempt.findUnique.mockResolvedValue(null);
    await expect(service.grade('t', 'att1', { ratings })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows re-grading an already SCORED attempt', async () => {
    const { prisma, gradebook, service } = setup();
    prisma.attempt.findUnique.mockResolvedValue({ ...submitted, status: AttemptStatus.SCORED });

    await service.grade('teacher1', 'att1', {
      ratings: [
        { itemId: 'w1', score: 1 },
        { itemId: 'w2', score: 1 },
        { itemId: 'w3', score: 1 },
      ],
    });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', expect.objectContaining({ newScore: 20 }));
  });
});
