import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoftLockController } from './soft-lock';

function makeLock(id: string, overrides: Partial<{ screen: boolean; input: boolean; message?: string }> = {}) {
  return { id, screen: true, input: true, expiresAt: Date.now() + 30_000, ...overrides };
}

function makeController(opts: { devMaxInputLockMs?: number } = {}) {
  const applyInputLock = vi.fn();
  const setOverlayActive = vi.fn();
  const controller = new SoftLockController({ applyInputLock, setOverlayActive, ...opts });
  return { controller, applyInputLock, setOverlayActive };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SoftLockController', () => {
  it('shows overlay and locks input once for a new id; does not re-apply for the same id re-sent', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { message: 'Eyes up front' }));
    expect(setOverlayActive).toHaveBeenCalledWith(true, 'Eyes up front');
    expect(applyInputLock).toHaveBeenCalledWith(true);
    expect(applyInputLock).toHaveBeenCalledTimes(1);

    controller.apply(makeLock('lock-1', { message: 'Eyes up front' }));
    expect(setOverlayActive).toHaveBeenCalledTimes(1); // no redundant re-show
    expect(applyInputLock).toHaveBeenCalledTimes(1);   // no re-lock
  });

  it('locks again for a genuinely new id', () => {
    const { controller, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1'));
    controller.apply(makeLock('lock-2'));
    expect(setOverlayActive).toHaveBeenCalledTimes(2);
  });

  it('apply(null) (Unlock) releases input and hides overlay immediately — no password prompt', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1'));
    applyInputLock.mockClear();
    setOverlayActive.mockClear();

    controller.apply(null);
    expect(applyInputLock).toHaveBeenCalledWith(false);
    expect(setOverlayActive).toHaveBeenCalledWith(false);
  });

  it('re-asserts input lock every second while locked', () => {
    const { controller, applyInputLock } = makeController();
    controller.apply(makeLock('lock-1'));
    applyInputLock.mockClear();

    vi.advanceTimersByTime(3_500);
    expect(applyInputLock).toHaveBeenCalledTimes(3);
    expect(applyInputLock).toHaveBeenCalledWith(true);
  });

  it('does not re-assert input when the lock only covers the screen', () => {
    const { controller, applyInputLock } = makeController();
    controller.apply(makeLock('lock-1', { input: false }));
    applyInputLock.mockClear();

    vi.advanceTimersByTime(5_000);
    expect(applyInputLock).not.toHaveBeenCalled();
  });

  it('self-clears (releases input, hides overlay) when the 30s failsafe expires without renew()', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1'));
    applyInputLock.mockClear();
    setOverlayActive.mockClear();

    vi.advanceTimersByTime(30_000);
    expect(applyInputLock).toHaveBeenCalledWith(false);
    expect(setOverlayActive).toHaveBeenCalledWith(false);
  });

  it('renew() extends the failsafe past 30s', () => {
    const { controller, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1'));

    vi.advanceTimersByTime(20_000);
    controller.renew();
    vi.advanceTimersByTime(20_000); // 40s total, but renew() reset the 30s clock at 20s
    expect(setOverlayActive).not.toHaveBeenCalledWith(false);

    vi.advanceTimersByTime(10_000); // now 30s past the renew — should have cleared
    expect(setOverlayActive).toHaveBeenCalledWith(false);
  });

  // ── Input-only lock (screen: false, input: true) ─────────────────────
  it('input-only lock: locks input, never shows the overlay, screen stays unchanged', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { screen: false, input: true }));

    // Input is locked
    expect(applyInputLock).toHaveBeenCalledWith(true);
    // Overlay explicitly cleared (guard against drift), never set true
    expect(setOverlayActive).toHaveBeenCalledWith(false);
    expect(setOverlayActive).not.toHaveBeenCalledWith(true, expect.anything());
  });

  it('input-only lock apply(null) releases input and clears overlay state', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { screen: false, input: true }));
    applyInputLock.mockClear();
    setOverlayActive.mockClear();

    controller.apply(null);
    expect(applyInputLock).toHaveBeenCalledWith(false);
    expect(setOverlayActive).toHaveBeenCalledWith(false);
  });

  it('full Lock → Lock Keyboard & Mouse: hides overlay, keeps input locked', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { screen: true, input: true }));
    expect(setOverlayActive).toHaveBeenCalledWith(true, undefined);

    controller.apply(makeLock('lock-2', { screen: false, input: true }));
    expect(setOverlayActive).toHaveBeenCalledWith(false); // overlay hidden
    expect(applyInputLock).toHaveBeenCalledWith(true);    // input still locked
  });

  it('Lock Keyboard & Mouse → full Lock: shows overlay, input stays locked', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { screen: false, input: true }));
    setOverlayActive.mockClear();

    controller.apply(makeLock('lock-2', { screen: true, input: true }));
    expect(setOverlayActive).toHaveBeenCalledWith(true, undefined); // overlay shown
    expect(applyInputLock).toHaveBeenCalledWith(true);              // input still locked
  });

  it('30s failsafe releases input for input-only lock', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController();
    controller.apply(makeLock('lock-1', { screen: false, input: true }));
    applyInputLock.mockClear();
    setOverlayActive.mockClear();

    vi.advanceTimersByTime(30_000);
    expect(applyInputLock).toHaveBeenCalledWith(false);
    expect(setOverlayActive).toHaveBeenCalledWith(false);
  });

  // ── devMaxInputLockMs ────────────────────────────────────────────────
  it('devMaxInputLockMs releases input locally after the cap, without clearing the lock state', () => {
    const { controller, applyInputLock, setOverlayActive } = makeController({ devMaxInputLockMs: 5_000 });
    controller.apply(makeLock('lock-1'));
    applyInputLock.mockClear();
    setOverlayActive.mockClear();

    vi.advanceTimersByTime(5_000);
    // Input released by dev cap
    expect(applyInputLock).toHaveBeenCalledWith(false);
    // But overlay / isActive not cleared — server still wants the lock
    expect(setOverlayActive).not.toHaveBeenCalledWith(false);
    expect(controller.isActive).toBe(true);
  });

  it('devMaxInputLockMs: a new lock id re-engages input after the cap', () => {
    const { controller, applyInputLock } = makeController({ devMaxInputLockMs: 5_000 });
    controller.apply(makeLock('lock-1'));
    vi.advanceTimersByTime(5_000); // dev cap fires
    applyInputLock.mockClear();

    controller.apply(makeLock('lock-2')); // new id → re-engage
    expect(applyInputLock).toHaveBeenCalledWith(true);
  });
});
