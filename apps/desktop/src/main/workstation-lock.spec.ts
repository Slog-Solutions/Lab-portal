import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEnforce, resolveGraceMs, WorkstationLockController } from './workstation-lock';

function makeLock(id: string, overrides: Partial<{ screen: boolean; input: boolean; message?: string; expiresAt: number }> = {}) {
  return { id, screen: true, input: true, expiresAt: Date.now() + 30_000, ...overrides };
}

/** `osLocked` is the fake "Windows is locked" bit the controller polls via
 * isOsLocked — tests flip it directly to simulate the OS actually locking
 * or a real sign-in unlocking it. */
function makeController(overrides: Partial<{ enforce: boolean; graceMs: number }> = {}) {
  const state = { osLocked: false };
  const lockFn = vi.fn(() => {
    state.osLocked = true;
  });
  const onNotice = vi.fn();
  const controller = new WorkstationLockController({
    lockFn,
    isOsLocked: () => state.osLocked,
    enforce: overrides.enforce ?? true,
    graceMs: overrides.graceMs ?? 2_000,
    onNotice,
  });
  return { controller, lockFn, onNotice, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkstationLockController', () => {
  it('locks once for a new id and does not re-lock for the same id re-sent', () => {
    const { controller, lockFn } = makeController();
    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    controller.apply(makeLock('lock-1'));
    vi.advanceTimersByTime(10_000);
    expect(lockFn).toHaveBeenCalledTimes(1);
  });

  it('locks again for a genuinely new id', () => {
    const { controller, lockFn } = makeController();
    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    controller.apply(makeLock('lock-2'));
    expect(lockFn).toHaveBeenCalledTimes(2);
  });

  it('apply(null) (Unlock) stops enforcement', () => {
    const { controller, lockFn, state } = makeController({ enforce: true });
    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    controller.apply(null);
    state.osLocked = false;
    controller.onOsUnlocked();
    vi.advanceTimersByTime(10_000);
    expect(lockFn).toHaveBeenCalledTimes(1);
  });

  it('self-clears (and stops enforcing) when the failsafe expires without renew()', () => {
    const { controller, lockFn, onNotice, state } = makeController({ enforce: true });
    controller.apply(makeLock('lock-1'));
    onNotice.mockClear();

    vi.advanceTimersByTime(30_000);
    expect(onNotice).toHaveBeenCalledWith(null);

    state.osLocked = false;
    controller.onOsUnlocked();
    expect(lockFn).toHaveBeenCalledTimes(1); // no re-lock — the lease already expired
  });

  it('renew() keeps the failsafe from expiring', () => {
    const { controller, lockFn, state } = makeController({ enforce: true });
    controller.apply(makeLock('lock-1'));

    vi.advanceTimersByTime(20_000);
    controller.renew();
    vi.advanceTimersByTime(20_000); // 40s total, but renew() reset the 30s clock at 20s

    state.osLocked = false;
    controller.onOsUnlocked(); // still active — schedules a real re-lock attempt after graceMs
    vi.advanceTimersByTime(2_000);
    expect(lockFn).toHaveBeenCalledTimes(2);
  });

  it('shows a grace notice then re-locks after graceMs when enforcing', () => {
    const { controller, lockFn, onNotice, state } = makeController({ enforce: true, graceMs: 2_000 });
    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    state.osLocked = false;
    controller.onOsUnlocked();
    expect(onNotice).toHaveBeenCalledWith('grace');
    expect(lockFn).toHaveBeenCalledTimes(1); // not yet — still in the grace window

    vi.advanceTimersByTime(2_000);
    expect(lockFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to the app overlay when Windows never actually locks', () => {
    const lockFn = vi.fn(); // never flips osLocked — simulates DisableLockWorkstation
    const onNotice = vi.fn();
    const controller = new WorkstationLockController({
      lockFn,
      isOsLocked: () => false,
      enforce: true,
      graceMs: 2_000,
      onNotice,
    });

    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000); // first check: not locked, retry
    expect(lockFn).toHaveBeenCalledTimes(2);
    expect(onNotice).not.toHaveBeenCalledWith('fallback');

    vi.advanceTimersByTime(3_000); // second check: still not locked, give up
    expect(lockFn).toHaveBeenCalledTimes(2);
    expect(onNotice).toHaveBeenCalledWith('fallback');
  });

  it('locks only once when enforce is false (dev safety)', () => {
    const { controller, lockFn, state } = makeController({ enforce: false });
    controller.apply(makeLock('lock-1'));
    expect(lockFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000); // let the initial-attempt retry check see it locked and stand down
    expect(lockFn).toHaveBeenCalledTimes(1);

    state.osLocked = false; // the developer signs back in on the same machine
    controller.onOsUnlocked();
    vi.advanceTimersByTime(10_000);
    expect(lockFn).toHaveBeenCalledTimes(1); // enforce=false — never re-locks
  });
});

describe('resolveEnforce', () => {
  it('falls back to isPackaged when unset', () => {
    expect(resolveEnforce(undefined, true)).toBe(true);
    expect(resolveEnforce(undefined, false)).toBe(false);
  });

  it('treats "1" and "true" as on, regardless of isPackaged', () => {
    expect(resolveEnforce('1', false)).toBe(true);
    expect(resolveEnforce('true', false)).toBe(true);
  });

  it('treats any other value as off', () => {
    expect(resolveEnforce('0', true)).toBe(false);
    expect(resolveEnforce('false', true)).toBe(false);
  });
});

describe('resolveGraceMs', () => {
  it('defaults to 2000 when unset or invalid', () => {
    expect(resolveGraceMs(undefined)).toBe(2_000);
    expect(resolveGraceMs('not-a-number')).toBe(2_000);
    expect(resolveGraceMs('-5')).toBe(2_000);
  });

  it('floors at 1000', () => {
    expect(resolveGraceMs('500')).toBe(1_000);
  });

  it('passes through a valid value above the floor', () => {
    expect(resolveGraceMs('5000')).toBe(5_000);
  });
});
