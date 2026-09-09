import type { RemoteInputEvent } from '@lab/shared/events';

/**
 * The contract the real Win32 addon (Phase 1) and the dev-mode stub both
 * implement — apps/desktop codes against this interface only, so swapping
 * the stub for the real `lab_native.node` binding is a one-file change,
 * not a rewrite of every caller.
 *
 * Every method here has real, documented platform risk (design doc §3.2,
 * §3.4, §5 risk register). Do not treat this interface as settled until
 * the week-1 spikes have run on the actual Windows 11 Pro lab image:
 *   1. Does BlockInput require elevation on this image? (undocumented)
 *   2. Can a normal-integrity LL hook suppress input to elevated windows? (UIPI, uncertain)
 *   3. Does the hook survive LowLevelHooksTimeout under real load?
 */
export interface NativeBridge {
  /**
   * Installs WH_KEYBOARD_LL / WH_MOUSE_LL hooks that swallow input except
   * a local failsafe chord. MUST run its own native message pump — the
   * hook proc must be O(1) and touch no JS, or Windows silently removes
   * it (LowLevelHooksTimeout). Returns false if installation fails.
   */
  installInputLock(options: { failsafeChord: string }): boolean;
  removeInputLock(): void;
  isInputLocked(): boolean;

  /** Replays one remote-control input event (design doc §3.4). Phase 1
   * implements this via nut.js (NutjsNativeBridge, real — see build plan
   * "week one spike" sequencing: replay first, hooks later); a future
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
        'the real Win32 addon has not been built yet (see build plan "week one spike"). ' +
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
