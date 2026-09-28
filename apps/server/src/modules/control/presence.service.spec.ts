import { describe, expect, it, vi } from 'vitest';
import { StationLifecycle } from '@lab/shared';
import { PresenceService } from './presence.service';
import type { LockService } from './lock.service';
import type { ScreenShareService } from './screen-share.service';

function makeFakeLocks(overrides: Record<string, unknown> = {}) {
  return { get: vi.fn().mockReturnValue(null), lock: vi.fn(), unlock: vi.fn(), listLockedStationIds: vi.fn(), ...overrides };
}

function makeFakeScreenShares(overrides: Record<string, unknown> = {}) {
  return { isPresenting: vi.fn().mockReturnValue(false), ...overrides };
}

function makeService(
  locks: ReturnType<typeof makeFakeLocks>,
  screenShares: ReturnType<typeof makeFakeScreenShares> = makeFakeScreenShares(),
): PresenceService {
  return new PresenceService(locks as unknown as LockService, screenShares as unknown as ScreenShareService);
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
 * Regression guard for the dashboard-tile-goes-OFFLINE bug this pass
 * fixed: a packaged Electron station opens TWO sockets (main process +
 * renderer) under the same stationId, and the old single-socketId entry
 * meant whichever one disconnected first tore down presence entirely —
 * heartbeat() then no-ops with no entry, so the surviving socket could
 * never resurrect it. Presence must only actually go offline once every
 * one of a station's live sockets has dropped.
 */
describe('PresenceService socket refcounting', () => {
  function makeService() {
    return new PresenceService(makeFakeLocks() as unknown as LockService, makeFakeScreenShares() as unknown as ScreenShareService);
  }

  it('stays online when one of two sockets for the same station disconnects', () => {
    const service = makeService();
    service.upsert({ ...baseEntry, socketId: 'sock1' });
    service.upsert({ ...baseEntry, socketId: 'sock2' });

    const wentOffline = service.removeSocket('st1', 'sock1');

    expect(wentOffline).toBe(false);
    expect(service.isOnline('st1')).toBe(true);
  });

  it('goes offline only once every socket for the station has disconnected', () => {
    const service = makeService();
    service.upsert({ ...baseEntry, socketId: 'sock1' });
    service.upsert({ ...baseEntry, socketId: 'sock2' });

    expect(service.removeSocket('st1', 'sock1')).toBe(false);
    const wentOffline = service.removeSocket('st1', 'sock2');

    expect(wentOffline).toBe(true);
    expect(service.isOnline('st1')).toBe(false);
  });

  it('removeSocket on an unknown station is a harmless no-op', () => {
    const service = makeService();
    expect(service.removeSocket('never-registered', 'sockX')).toBe(false);
  });
});

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

/**
 * Round Table's chairman/speaker disconnect handling (Ser 3) hangs off these
 * transitions, so each way a station can appear or vanish must fire exactly
 * once — and only for a REAL transition (a second socket from the same
 * station, or a renderer reload, is not one).
 */
describe('PresenceService.onChange', () => {
  it('fires online once for a station, not for its second socket', () => {
    const service = makeService(makeFakeLocks());
    const listener = vi.fn();
    service.onChange(listener);
    service.upsert(baseEntry);
    service.upsert({ ...baseEntry, socketId: 'sock2' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('st1', true);
  });

  it('fires offline only when the LAST socket drops', () => {
    const service = makeService(makeFakeLocks());
    const listener = vi.fn();
    service.upsert(baseEntry);
    service.upsert({ ...baseEntry, socketId: 'sock2' });
    service.onChange(listener);
    service.removeSocket('st1', 'sock1');
    expect(listener).not.toHaveBeenCalled();
    service.removeSocket('st1', 'sock2');
    expect(listener).toHaveBeenCalledExactlyOnceWith('st1', false);
  });

  it('fires offline for a station that misses its heartbeats', () => {
    vi.useFakeTimers();
    try {
      const service = makeService(makeFakeLocks());
      service.upsert({ ...baseEntry, lastHeartbeatAt: Date.now() });
      const listener = vi.fn();
      service.onChange(listener);
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(6_000);
        service.sweepMissedHeartbeats();
      }
      expect(listener).toHaveBeenCalledExactlyOnceWith('st1', false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a throwing listener cannot break presence or starve another listener', () => {
    const service = makeService(makeFakeLocks());
    const good = vi.fn();
    service.onChange(() => {
      throw new Error('boom');
    });
    service.onChange(good);
    expect(() => service.upsert(baseEntry)).not.toThrow();
    expect(good).toHaveBeenCalledWith('st1', true);
    expect(service.isOnline('st1')).toBe(true);
  });

  it('unsubscribe stops notifications', () => {
    const service = makeService(makeFakeLocks());
    const listener = vi.fn();
    const off = service.onChange(listener);
    off();
    service.upsert(baseEntry);
    expect(listener).not.toHaveBeenCalled();
  });
});
