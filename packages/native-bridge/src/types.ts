import type { RemoteInputEvent } from '@lab/shared/events';

/**
 * The contract the real Win32 KoffiNativeBridge and the dev-mode stub both
 * implement — apps/desktop codes against this interface only, so swapping
 * the stub for the real binding is a one-file change, not a rewrite of
 * every caller.
 *
 * Lock tier (implemented in koffi-bridge.ts):
 *   WH_KEYBOARD_LL / WH_MOUSE_LL hooks registered via koffi.register()
 *   and installed with SetWindowsHookExW. Injected (synthetic) events
 *   pass through unconditionally so the teacher's Take Remote Control
 *   (nut.js SendInput) still works on an input-locked seat. BlockInput is
 *   kept as a fallback if hook installation fails.
 *
 * `failsafeChord` is OPTIONAL and unused by this tier — the hooks die with
 * the Electron process, so a crash can never leave input locked. The
 * caller's own 30s lease failsafe (soft-lock.ts) self-releases any
 * surviving lock within that window regardless.
 *
 * Known OS limits (design doc §3.2, by construction at medium integrity):
 *   1. Ctrl+Alt+Del and Win+L can never be blocked by a hook.
 *   2. A medium-integrity hook does not see input aimed at an elevated
 *      window (UIPI — relevant only if a student launches an elevated app).
 *   3. A hook is silently dropped by Windows after LowLevelHooksTimeout if
 *      the main thread stalls; soft-lock.ts's 1s re-assert tick re-installs
 *      it (new hooks first, old ones unhooked second — no gap).
 */
export interface NativeBridge {
  /**
   * Installs WH_KEYBOARD_LL / WH_MOUSE_LL hooks that swallow physical
   * input while passing injected (synthetic) events through. Returns false
   * if installation fails (falls back to BlockInput). Re-calling while
   * already locked re-installs (recovers from a silently dropped hook).
   * `failsafeChord` is unused — hook lifetime is process lifetime.
   */
  installInputLock(options?: { failsafeChord?: string }): boolean;
  removeInputLock(): void;
  isInputLocked(): boolean;

  /** Replays one remote-control input event (design doc §3.4). Phase 1
   * implements this via nut.js (NutjsNativeBridge, real — see build plan
   * \"week one spike\" sequencing: replay first, hooks later); a future
   * hook-based addon would replace it with raw SendInput without
   * changing this signature. Async because nut.js's mouse/keyboard calls
   * are themselves promise-based. */
  replayInput(event: RemoteInputEvent): Promise<void>;

  /**
   * BlockInput wrapper — enhancement only, never the primary lock
   * mechanism (it auto-releases on Ctrl+Alt+Del and its elevation
   * requirement on this image is unverified). MUST be paired with a
   * watchdog timer by the caller; only the blocking thread can undo it.
   */
  blockInput(blocked: boolean): boolean;
}

export class NotImplementedNativeBridge implements NativeBridge {
  private locked = false;

  installInputLock(): boolean {
    // eslint-disable-next-line no-console
    console.warn(
      '[native-bridge] installInputLock() called on the stub implementation — ' +
        'hooks are unavailable in this environment. ' +
        'No input is actually being locked.',
    );
    this.locked = true;
    return false;
  }

  removeInputLock(): void {
    this.locked = false;
  }

  isInputLocked(): boolean {
    return this.locked;
  }

  async replayInput(): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn('[native-bridge] replayInput() is a no-op on the stub implementation.');
  }

  blockInput(): boolean {
    return false;
  }
}
