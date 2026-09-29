import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/**
 * Regression for a pre-existing bug found while implementing
 * SPEC-mcq-test-timed-reveal.md: ItemResponse.itemId has a real FK to
 * Item with no cascade, so setItems/importItems(append: false) deleting
 * items a real attempt already answered would throw a raw Postgres
 * constraint violation instead of a clean 409.
 */
function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    exercise: { findUnique: vi.fn().mockResolvedValue({ id: 'ex1', teacherId: 'teacher1', itemBank: null }) },
    attempt: { count: vi.fn().mockResolvedValue(0) },
    itemBank: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'bank1' }) },
    item: { deleteMany: vi.fn(), createMany: vi.fn(), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>): ExercisesService {
  const audit = { log: vi.fn() };
  return new ExercisesService(prisma as unknown as PrismaService, audit as unknown as AuditService);
}

const requester = { id: 'teacher1', role: 'TEACHER' };
const items = [{ type: 'SHORT_ANSWER' as const, prompt: 'q', answer: 'a' }];

describe('ExercisesService.setItems / importItems — attempt guard', () => {
  it('setItems refuses with 409 once the exercise has any attempt, and deletes nothing', async () => {
    const prisma = makeFakePrisma({ attempt: { count: vi.fn().mockResolvedValue(1) } });
    const service = makeService(prisma);

    await expect(service.setItems('ex1', items, requester)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
  });

  it('setItems still works normally when the exercise has no attempts', async () => {
    const prisma = makeFakePrisma();
    const service = makeService(prisma);

    await service.setItems('ex1', items, requester);
    expect(prisma.item.deleteMany).toHaveBeenCalled();
    expect(prisma.item.createMany).toHaveBeenCalled();
  });

  it('importItems(append: false) refuses with 409 once the exercise has any attempt', async () => {
    const prisma = makeFakePrisma({ attempt: { count: vi.fn().mockResolvedValue(1) } });
    const service = makeService(prisma);

    await expect(service.importItems('ex1', items, false, requester)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
  });

  it('importItems(append: true) is unaffected — it only adds rows, never deletes', async () => {
    const prisma = makeFakePrisma({ attempt: { count: vi.fn().mockResolvedValue(1) } });
    const service = makeService(prisma);

    await service.importItems('ex1', items, true, requester);
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
    expect(prisma.item.createMany).toHaveBeenCalled();
  });
});
