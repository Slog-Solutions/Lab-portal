import { describe, expect, it, vi } from 'vitest';
import { LockService } from './lock.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    lockGrant: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    station: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma> = makeFakePrisma()): LockService {
  return new LockService(prisma as unknown as PrismaService);
}

const soft = { mode: 'soft' as const, screen: true, input: true, lockedBy: 'teacher1' };

describe('LockService', () => {
  it('lock() writes a user-scoped grant when someone is seated, a station-scoped one otherwise', async () => {
    const service = makeService();

    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    expect(service.get('st1')?.lockedBy).toBe('teacher1');

    service.setSeatOccupant('st1', null);
    expect(service.get('st1')).toBeNull(); // the user-scoped grant does not follow an empty seat

    await service.lock('st2', soft);
    expect(service.get('st2')).not.toBeNull(); // a station-scoped grant needs no occupant at all
  });

  it('a station grant beats an inherited student grant for the same seat', async () => {
    const service = makeService();

    // The student is locked while seated...
    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    // ...then leaves, and the now-idle PC gets its own explicit lock...
    service.setSeatOccupant('st1', null);
    await service.lock('st1', { ...soft, mode: 'windows' });
    // ...and the same student sits back down.
    service.setSeatOccupant('st1', 'user1');

    expect(service.get('st1')?.mode).toBe('windows'); // the station's own grant, not the student's
  });

  it('setSeatOccupant makes a locked student\'s lock appear at whatever seat they move to', async () => {
    const service = makeService();

    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    expect(service.get('st2')).toBeNull();

    service.setSeatOccupant('st1', null);
    service.setSeatOccupant('st2', 'user1');

    expect(service.get('st2')?.lockedBy).toBe('teacher1');
    expect(service.get('st1')).toBeNull();
  });

  it('listLockedStationIds resolves an inherited student lock through seatOccupant, so heartbeat renewal reaches it', async () => {
    const service = makeService();

    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    expect(service.listLockedStationIds()).toEqual(['st1']);

    service.setSeatOccupant('st1', null);
    service.setSeatOccupant('st2', 'user1');
    expect(service.listLockedStationIds()).toEqual(['st2']);
  });

  it('unlock() clears both the station grant and its seated student\'s grant', async () => {
    const service = makeService();

    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    await service.unlock('st1');

    expect(service.get('st1')).toBeNull();
    service.setSeatOccupant('st2', 'user1');
    expect(service.get('st2')).toBeNull(); // the student's own grant is gone too, not just the station's
  });

  it('clearStationGrant only clears the station-scoped grant, never the departing student\'s own grant', async () => {
    const service = makeService();

    service.setSeatOccupant('st1', 'user1');
    await service.lock('st1', soft);
    service.setSeatOccupant('st1', null);
    await service.clearStationGrant('st1');

    service.setSeatOccupant('st2', 'user1');
    expect(service.get('st2')?.lockedBy).toBe('teacher1'); // the student's lock survived and followed them
  });

  it('onModuleInit rehydrates locks and seat occupancy from Postgres', async () => {
    const lockedAt = new Date();
    const prisma = makeFakePrisma({
      lockGrant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'g1', userId: 'user1', stationId: null, mode: 'soft', screen: true, input: true, message: null, lockedById: 'teacher1', lockedAt },
          { id: 'g2', userId: null, stationId: 'st2', mode: 'windows', screen: true, input: false, message: 'Eyes front', lockedById: 'teacher2', lockedAt },
        ]),
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
      station: {
        findMany: vi.fn().mockResolvedValue([{ id: 'st1', currentUserId: 'user1' }]),
        findUnique: vi.fn(),
      },
    });
    const service = makeService(prisma);

    await service.onModuleInit();

    expect(service.get('st1')?.id).toBe('g1'); // inherited via seat occupancy read from Station.currentUserId
    expect(service.get('st2')?.id).toBe('g2'); // station-scoped
    expect(service.get('st2')?.mode).toBe('windows');
    expect(service.get('st2')?.message).toBe('Eyes front');
  });
});
