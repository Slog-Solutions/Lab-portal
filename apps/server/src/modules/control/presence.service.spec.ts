import { describe, expect, it, vi } from 'vitest';
import { StationLifecycle } from '@lab/shared';
import { PresenceService } from './presence.service';
import type { LockService } from './lock.service';

function makeFakeLocks(overrides: Record<string, unknown> = {}) {
  return { get: vi.fn().mockReturnValue(null), lock: vi.fn(), unlock: vi.fn(), listLockedStationIds: vi.fn(), ...overrides };
}

function makeService(locks: ReturnType<typeof makeFakeLocks>): PresenceService {
  return new PresenceService(locks as unknown as LockService);
}

const baseEntry = {
  stationId: 'st1',
  seatNo: 2,
  socketId: 'sock1',
  appVersion: '1.0.0',
  osBuild: 'win11',
  ip: '10.0.0.5',
  lastHeartbeatAt: Date.now(),
  lockState: { screen: false, input: false },
  activityId: null,
  classTeacherId: 'teacher1',
};

/**
 * Regression guard for the dashboard-tile lag this pass fixed: toStatusPatch
 * used to derive `lock`/lifecycle from the station's self-reported
 * heartbeat.lockState, which only ever refreshes every 5s and could be
 * clobbered by a heartbeat already in flight when a lock/unlock lands. It
 * must instead read LockService directly — the server's own intent — so a
 * lock/unlock is reflected the instant ControlController applies it.
 */
describe('PresenceService.toStatusPatch', () => {
  it('reports READY and lock:null when LockService has no entry, even if the last heartbeat.lockState says locked', () => {
    const locks = makeFakeLocks();
    const service = makeService(locks);
    service.upsert({ ...baseEntry, lockState: { screen: true, input: true } });

    const patch = service.toStatusPatch('st1');
    expect(patch.lifecycle).toBe(StationLifecycle.READY);
    expect(patch.lock).toBeNull();
  });

  it('reports LOCKED with the lock entry\'s screen/input the instant LockService has one, before any heartbeat confirms it', () => {
    const locks = makeFakeLocks({
      get: vi.fn().mockReturnValue({ id: 'lock-1', screen: true, input: false, lockedBy: 'teacher1', lockedAt: Date.now() }),
    });
    const service = makeService(locks);
    service.upsert(baseEntry); // heartbeat.lockState still says unlocked

    const patch = service.toStatusPatch('st1');
    expect(patch.lifecycle).toBe(StationLifecycle.LOCKED);
    expect(patch.lock).toEqual({ screen: true, input: false });
  });

  it('an offline station (no presence entry) is always OFFLINE regardless of LockService', () => {
    const locks = makeFakeLocks({
      get: vi.fn().mockReturnValue({ id: 'lock-1', screen: true, input: true, lockedBy: 'teacher1', lockedAt: Date.now() }),
    });
    const service = makeService(locks);

    const patch = service.toStatusPatch('never-registered');
    expect(patch.lifecycle).toBe(StationLifecycle.OFFLINE);
    expect(patch.lock).toBeNull();
  });
});
