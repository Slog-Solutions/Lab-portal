import { execFile } from 'node:child_process';
import type { DesiredStationState } from '@lab/shared';

type LockState = NonNullable<DesiredStationState['lock']>;
export type NoticeKind = 'grace' | 'fallback' | null;

const FAILSAFE_GRACE_MS = 30_000; // matches the server's lock-lease heartbeat window
const RETRY_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_GRACE_MS = 2_000;
const MIN_GRACE_MS = 1_000;

/** `rundll32 user32.dll,LockWorkStation` — the real Windows lock (Win+L).
 * Exits 0 even if Windows refuses (e.g. a policy blocks it), so success
 * is never inferred from this call; it's confirmed from powerMonitor's
 * lock-screen event instead (see WorkstationLockController). */
export function lockWorkstation(): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const rundll32 = `${systemRoot}\\System32\\rundll32.exe`;
  return new Promise((resolve) => {
    execFile(rundll32, ['user32.dll,LockWorkStation'], () => resolve());
  });
}

/** `LAB_LOCK_ENFORCE` if set ('1'/'true' → on, anything else → off), else
 * `isPackaged`. Dev safety measure: the developer typically runs the
 * station and the teacher dashboard on the same PC, so an unpackaged
 * `npm run dev` should lock once rather than re-locking them out of their
 * own machine every time they sign back in. */
export function resolveEnforce(env: string | undefined, isPackaged: boolean): boolean {
  if (env === undefined) return isPackaged;
  return env === '1' || env.toLowerCase() === 'true';
}

/** `LAB_LOCK_RELOCK_GRACE_MS`, default 2000, floored at 1000 — Windows can
 * ignore a lock request made the instant a sign-in completes. */
export function resolveGraceMs(env: string | undefined): number {
  const parsed = Number(env);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GRACE_MS;
  return Math.max(MIN_GRACE_MS, parsed);
}

export interface WorkstationLockControllerOptions {
  lockFn: () => Promise<void> | void;
  isOsLocked: () => boolean;
  enforce: boolean;
  graceMs: number;
  onNotice: (kind: NoticeKind) => void;
}

/**
 * Drives the real Windows lock from a DesiredStationState.lock (or null).
 * Imports nothing from Electron — every OS-facing dependency is passed in
 * — so this can be unit-tested without a display or a real Windows box.
 *
 * `lock.id` (see packages/shared/src/types/desired-state.ts) is what lets
 * apply() tell a brand new Lock click apart from the same lock re-sent in
 * a later snapshot: snapshots are pushed for many unrelated reasons (a
 * classroom sign-in, an activity change, ...), and re-running requestLock
 * on every single one of them would spam LockWorkStation and restart the
 * grace/fallback cycle for no reason.
 */
export class WorkstationLockController {
  private activeId: string | null = null;
  private lastKnownLocked = false;
  private failsafeTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;

  constructor(private readonly opts: WorkstationLockControllerOptions) {}

  apply(lock: LockState | null): void {
    if (!lock) {
      this.clear();
      return;
    }
    if (lock.id === this.activeId) {
      this.armFailsafe();
      return;
    }
    this.clearPending();
    this.activeId = lock.id;
    this.lastKnownLocked = this.opts.isOsLocked();
    this.armFailsafe();
    this.startPoll();
    this.requestLock();
  }

  /** Called on every server lock:heartbeat — renews the failsafe window. */
  renew(): void {
    if (this.activeId) this.armFailsafe();
  }

  onOsLocked(): void {
    this.lastKnownLocked = true;
    this.opts.onNotice(null);
    this.clearPending();
  }

  onOsUnlocked(): void {
    this.lastKnownLocked = false;
    if (!this.activeId || !this.opts.enforce) return;
    this.opts.onNotice('grace');
    this.graceTimer = setTimeout(() => this.requestLock(), this.opts.graceMs);
  }

  /** Stops all timers and forgets the active lock — call on app shutdown. */
  destroy(): void {
    this.clear();
  }

  private requestLock(lockId = this.activeId): void {
    if (!lockId || lockId !== this.activeId) return;
    // A grace-period re-lock can fire while the original attempt's own
    // retry check is still pending — without this, the stale timer would
    // later run checkAndMaybeRetry against whatever the OS lock state
    // happens to be by then, not the cycle it was actually checking.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    void this.opts.lockFn();
    this.retryTimer = setTimeout(() => this.checkAndMaybeRetry(lockId, false), RETRY_DELAY_MS);
  }

  private checkAndMaybeRetry(lockId: string, alreadyRetried: boolean): void {
    if (lockId !== this.activeId) return;
    if (this.opts.isOsLocked()) return;
    if (alreadyRetried) {
      // eslint-disable-next-line no-console
      console.warn('[workstation-lock] Windows did not lock after retry — falling back to the app overlay');
      this.opts.onNotice('fallback');
      return;
    }
    void this.opts.lockFn();
    this.retryTimer = setTimeout(() => this.checkAndMaybeRetry(lockId, true), RETRY_DELAY_MS);
  }

  private armFailsafe(): void {
    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    this.failsafeTimer = setTimeout(() => this.clear(), FAILSAFE_GRACE_MS);
  }

  private startPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    // Backs up powerMonitor's lock-screen/unlock-screen events in case one
    // is ever missed — most load-bearing for the unlocked transition,
    // since that's the one enforcement actually depends on.
    this.pollTimer = setInterval(() => {
      if (!this.activeId) return;
      const locked = this.opts.isOsLocked();
      if (locked === this.lastKnownLocked) return;
      if (locked) this.onOsLocked();
      else this.onOsUnlocked();
    }, POLL_INTERVAL_MS);
  }

  private clearPending(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private clear(): void {
    this.activeId = null;
    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    this.failsafeTimer = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.clearPending();
    this.opts.onNotice(null);
  }
}
