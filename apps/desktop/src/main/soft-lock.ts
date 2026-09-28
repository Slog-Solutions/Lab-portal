import type { DesiredStationState } from '@lab/shared';

type LockState = NonNullable<DesiredStationState['lock']>;

const FAILSAFE_GRACE_MS = 30_000; // matches the server's lock-lease heartbeat window (see workstation-lock.ts)
const REASSERT_INTERVAL_MS = 1_000; // re-assert every second in case setIgnoreMouseEvents was reset

export interface SoftLockControllerOptions {
  /**
   * Called to apply or release the Electron-level input lock:
   *  - true  → `win.setIgnoreMouseEvents(true)` + swallow `before-input-event`
   *  - false → `win.setIgnoreMouseEvents(false)` + stop swallowing keyboard
   *
   * Transport: the existing ControlClient WebSocket (Option A from spec) —
   * the server pushes lock/unlock as part of the station snapshot, no
   * separate channel needed. index.ts wires this to the mainWindow directly.
   *
   * Safety guarantees (spec §Part 3):
   *  - Resets to false on app quit (before-quit clears via destroy()).
   *  - 30s failsafe self-unlocks if the server stops heartbeating.
   *  - devMaxInputLockMs provides an additional dev-time cap.
   *  - `inputLocked` flag is the single source of truth — both mouse
   *    and keyboard always stay in sync.
   */
  applyInputLock: (locked: boolean) => void;
  /**
   * Reports whether the app-level cover overlay should be showing.
   * Only used when `screen: true`; input-only lock leaves screen untouched.
   */
  setOverlayActive: (active: boolean, message?: string) => void;
  /**
   * Dev-only safety cap: auto-release input locally after this many ms.
   * Only pass when `!app.isPackaged`. Prevents a dev who locks their own
   * PC from being stuck when the test server goes away.
   */
  devMaxInputLockMs?: number;
}

/**
 * Drives the SOFT lock from a DesiredStationState.lock whose mode is
 * 'soft'. Honors `screen` and `input` flags independently:
 *
 *  - screen: true  → overlay shown (covers the screen).
 *  - input: true   → Electron input lock engaged:
 *                      • mouse  → win.setIgnoreMouseEvents(true)
 *                      • keyboard → before-input-event preventDefault()
 *  - screen: false + input: true → screen stays fully visible, only
 *    input is frozen. No visual change whatsoever (spec §Part 4 §3).
 *
 * Transport: the existing ControlClient WebSocket already delivers
 * lock/unlock as part of every station snapshot (Option A from spec).
 * No separate lock channel is needed.
 *
 * Safety: 30s failsafe self-releases if the server stops heartbeating.
 * On quit/reload, destroy() resets inputLocked to false (spec §Part 3 §4).
 * devMaxInputLockMs adds a dev-time cap so a dev is never permanently stuck.
 */
export class SoftLockController {
  private activeId: string | null = null;
  private inputLocked = false;
  private overlayActive = false;
  private failsafeTimer?: NodeJS.Timeout;
  private reassertTimer?: NodeJS.Timeout;
  private devCapTimer?: NodeJS.Timeout;

  constructor(private readonly opts: SoftLockControllerOptions) {}

  get isActive(): boolean {
    return this.activeId !== null;
  }

  apply(lock: LockState | null): void {
    if (!lock) {
      this.clear();
      return;
    }
    if (lock.id === this.activeId) {
      // Same lock id re-sent (snapshot from a classroom sign-in, activity
      // change, etc.) — just renew the failsafe, don't re-apply.
      this.armFailsafe();
      return;
    }

    this.activeId = lock.id;

    // --- Screen overlay ---
    if (lock.screen) {
      this.opts.setOverlayActive(true, lock.message);
      this.overlayActive = true;
    } else {
      // Always explicitly clear — guards against softLockActive drift.
      this.opts.setOverlayActive(false);
      this.overlayActive = false;
    }

    // --- Input lock (mouse + keyboard via Electron APIs) ---
    if (lock.input) {
      this.engageInput();
    } else {
      this.releaseInput();
    }

    this.armFailsafe();
    this.startReassertTick(lock);
    this.armDevCap(lock);
  }

  /** Called on every server lock:heartbeat — renews the failsafe window. */
  renew(): void {
    if (this.activeId) this.armFailsafe();
  }

  /** Stops all timers and releases input/overlay — call on app shutdown. */
  destroy(): void {
    this.clear();
  }

  private engageInput(): void {
    this.opts.applyInputLock(true);
    this.inputLocked = true;
  }

  private releaseInput(): void {
    if (this.inputLocked) {
      this.opts.applyInputLock(false);
      this.inputLocked = false;
    }
  }

  private startReassertTick(lock: LockState): void {
    if (this.reassertTimer) clearInterval(this.reassertTimer);
    if (!lock.input) return;
    // Re-assert every second in case setIgnoreMouseEvents was somehow reset
    // (e.g. a window recreation in an edge case). Cheap and idempotent.
    this.reassertTimer = setInterval(() => {
      if (!this.activeId) return;
      this.opts.applyInputLock(true);
    }, REASSERT_INTERVAL_MS);
  }

  private armDevCap(lock: LockState): void {
    if (!this.opts.devMaxInputLockMs || !lock.input) return;
    if (this.devCapTimer) clearTimeout(this.devCapTimer);
    const capMs = this.opts.devMaxInputLockMs;
    this.devCapTimer = setTimeout(() => {
      this.releaseInput();
      // eslint-disable-next-line no-console
      console.warn(`[soft-lock] devMaxInputLockMs (${capMs}ms) expired — input released locally. A new lock id will re-engage.`);
    }, capMs);
  }

  private clear(): void {
    const wasActive = this.activeId !== null;
    this.activeId = null;

    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    this.failsafeTimer = undefined;
    if (this.reassertTimer) clearInterval(this.reassertTimer);
    this.reassertTimer = undefined;
    if (this.devCapTimer) clearTimeout(this.devCapTimer);
    this.devCapTimer = undefined;

    this.releaseInput();

    if (wasActive) {
      this.opts.setOverlayActive(false);
      this.overlayActive = false;
    }
  }

  private armFailsafe(): void {
    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    // No renewal within the grace window — server is gone, crashed, or
    // the network dropped. Self-unlock. No teacher action required.
    this.failsafeTimer = setTimeout(() => this.clear(), FAILSAFE_GRACE_MS);
  }
}
