import { describe, expect, it, vi } from 'vitest';
import { DictionaryExportService } from './dictionary-export.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DictionaryEntryRow, DictionaryStoreService } from './dictionary-store.service';

/** Same "fake $transaction just runs the callback against itself" pattern
 * as assessments.service.spec.ts. */
function makePrisma() {
  const prisma = {
    exercise: {
      create: vi.fn().mockResolvedValue({ id: 'ex1' }),
      update: vi.fn(),
    },
    itemBank: { create: vi.fn().mockResolvedValue({ id: 'bank1' }) },
    item: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
}

function makeFakeStore(overrides: Partial<Record<keyof DictionaryStoreService, unknown>> = {}) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    findAllByHeadword: vi.fn().mockReturnValue([]),
    sensesForEntry: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as DictionaryStoreService;
}

describe('DictionaryExportService.exportToItemBank', () => {
  it('creates an exercise, an item bank, and wires config.itemBankId in one transaction', async () => {
    const prisma = makePrisma();
    const svc = new DictionaryExportService(prisma as unknown as PrismaService, makeFakeStore());

    const result = await svc.exportToItemBank('teacher1', 'Struggled words', ['run', 'mouse']);

    expect(prisma.exercise.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ teacherId: 'teacher1', title: 'Struggled words', type: 'VOCABULARY_TEST' }) }),
    );
    expect(prisma.itemBank.create).toHaveBeenCalledWith({ data: { exerciseId: 'ex1' } });
    expect(prisma.item.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ itemBankId: 'bank1', order: 0, answer: 'run' }),
          expect.objectContaining({ itemBankId: 'bank1', order: 1, answer: 'mouse' }),
        ],
      }),
    );
    expect(prisma.exercise.update).toHaveBeenCalledWith({ where: { id: 'ex1' }, data: { config: { itemBankId: 'bank1', shuffleItems: true } } });
    expect(result).toEqual({ exerciseId: 'ex1', itemCount: 2 });
  });

  it('deduplicates repeated words', async () => {
    const prisma = makePrisma();
    const svc = new DictionaryExportService(prisma as unknown as PrismaService, makeFakeStore());
    const result = await svc.exportToItemBank('teacher1', 'Words', ['run', 'run', ' run ']);
    expect(result.itemCount).toBe(1);
  });

  it('masks the word out of its own first-sense definition', async () => {
    const store = makeFakeStore({
      findAllByHeadword: vi.fn().mockReturnValue([{ id: 1 } as DictionaryEntryRow]),
      sensesForEntry: vi.fn().mockReturnValue([{ id: 1, entry_id: 1, ord: 1, definition: 'Run fast; to run is healthy.', example: null, synonyms: '[]', source: 'oewn' }]),
    });
    const prisma = makePrisma();
    const svc = new DictionaryExportService(prisma as unknown as PrismaService, store);
    await svc.exportToItemBank('teacher1', 'Words', ['run']);

    const items = prisma.item.createMany.mock.calls[0]![0].data as Array<{ prompt: string }>;
    expect(items[0]!.prompt).toBe('____ fast; to ____ is healthy.');
  });

  it('falls back to the bare word when the dictionary is unavailable', async () => {
    const store = makeFakeStore({ isAvailable: vi.fn().mockReturnValue(false) });
    const prisma = makePrisma();
    const svc = new DictionaryExportService(prisma as unknown as PrismaService, store);
    await svc.exportToItemBank('teacher1', 'Words', ['resolve']);

    const items = prisma.item.createMany.mock.calls[0]![0].data as Array<{ prompt: string }>;
    expect(items[0]!.prompt).toBe('resolve');
  });

  it('falls back to the bare word when there is no entry for it', async () => {
    const prisma = makePrisma();
    const svc = new DictionaryExportService(prisma as unknown as PrismaService, makeFakeStore());
    await svc.exportToItemBank('teacher1', 'Words', ['zzznonexistent']);

    const items = prisma.item.createMany.mock.calls[0]![0].data as Array<{ prompt: string }>;
    expect(items[0]!.prompt).toBe('zzznonexistent');
  });
});
