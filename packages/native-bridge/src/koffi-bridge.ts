import koffi from 'koffi';
import type { RemoteInputEvent } from '@lab/shared/events';
import type { NativeBridge } from './types';
import { NutjsNativeBridge } from './nutjs-bridge';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const BlockInput = user32.func('__stdcall', 'BlockInput', 'bool', ['bool']);
const SetWindowsHookExW = user32.func('__stdcall', 'SetWindowsHookExW', 'void*', ['int', 'void*', 'void*', 'uint32']);
const UnhookWindowsHookEx = user32.func('__stdcall', 'UnhookWindowsHookEx', 'bool', ['void*']);
const CallNextHookEx = user32.func('__stdcall', 'CallNextHookEx', 'intptr', ['void*', 'int', 'uintptr', 'intptr']);
const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void*', ['void*']);

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt_x: 'int32',
  pt_y: 'int32',
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const LowLevelHookProc = koffi.proto('__stdcall', 'LowLevelHookProc', 'intptr', ['int', 'uintptr', 'intptr']);

const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
/** Bit set in KBDLLHOOKSTRUCT.flags for injected (synthetic) keyboard events */
const LLKHF_INJECTED = 0x10;
/** Bit set in MSLLHOOKSTRUCT.flags for injected (synthetic) mouse events */
const LLMHF_INJECTED = 0x01;

/**
 * Tier 2 of loadNativeBridge()'s resolution — real OS-level input
 * suppression via WH_KEYBOARD_LL / WH_MOUSE_LL low-level hooks, plus
 * user32!BlockInput as a fallback. Ships a prebuilt win32-x64 binary
 * (verified: `koffi` needs no C++ toolchain). Composes NutjsNativeBridge
 * for replayInput — hooks only suppress, they have no SendInput API.
 *
 * Hook design:
 *  - Callbacks run on the Electron main thread's Win32 message loop — no
 *    extra pump is needed.
 *  - They die with the process, so a crash can never leave input locked.
 *  - Injected (synthetic) events (LLKHF_INJECTED / LLMHF_INJECTED) pass
 *    through unconditionally, so the teacher's Take Remote Control
 *    (nut.js SendInput) still works while a seat is input-locked.
 *  - Re-install recovers from Windows silently dropping a hook after
 *    LowLevelHooksTimeout if the main thread ever stalls (hooks first,
 *    old ones unhooked second — no gap).
 *
 * Known OS limits (by design, cannot be worked around at medium integrity):
 *  - Ctrl+Alt+Del and Win+L can never be blocked by a hook.
 *  - A medium-integrity hook does not see input aimed at an elevated window.
 *
 * BlockInput limits (documented, fallback only):
 *  - BlockInput is released the instant the user presses Ctrl+Alt+Del.
 *  - Only the thread that called BlockInput(true) can call BlockInput(false).
 */
export class KoffiNativeBridge implements NativeBridge {
  private readonly replay = new NutjsNativeBridge();
  private locked = false;

  private kbHook: unknown = null;
  private mouseHook: unknown = null;
  private kbCallback: bigint | null = null;
  private mouseCallback: bigint | null = null;

  installInputLock(): boolean {
    const hMod = GetModuleHandleW(null);

    const newKbCallback = koffi.register(
      (nCode: number, wParam: number, lParam: number): number => {
        if (nCode < 0) return CallNextHookEx(null, nCode, wParam, lParam) as number;
        try {
          const decoded = koffi.decode(lParam, KBDLLHOOKSTRUCT);
          if (decoded.flags & LLKHF_INJECTED) return CallNextHookEx(null, nCode, wParam, lParam) as number;
        } catch {
          // If decode fails, pass through to be safe
          return CallNextHookEx(null, nCode, wParam, lParam) as number;
        }
        return 1; // swallow physical keyboard input
      },
      koffi.pointer(LowLevelHookProc),
    );

    const newMouseCallback = koffi.register(
      (nCode: number, wParam: number, lParam: number): number => {
        if (nCode < 0) return CallNextHookEx(null, nCode, wParam, lParam) as number;
        try {
          const decoded = koffi.decode(lParam, MSLLHOOKSTRUCT);
          if (decoded.flags & LLMHF_INJECTED) return CallNextHookEx(null, nCode, wParam, lParam) as number;
        } catch {
          return CallNextHookEx(null, nCode, wParam, lParam) as number;
        }
        return 1; // swallow physical mouse input
      },
      koffi.pointer(LowLevelHookProc),
    );

    const newKbHook = SetWindowsHookExW(WH_KEYBOARD_LL, newKbCallback, hMod, 0);
    const newMouseHook = SetWindowsHookExW(WH_MOUSE_LL, newMouseCallback, hMod, 0);

    if (!newKbHook || !newMouseHook) {
      // Partial failure — unhook whatever succeeded before giving up
      if (newKbHook) UnhookWindowsHookEx(newKbHook);
      if (newMouseHook) UnhookWindowsHookEx(newMouseHook);
      koffi.unregister(newKbCallback);
      koffi.unregister(newMouseCallback);
      // eslint-disable-next-line no-console
      console.error('[native-bridge] SetWindowsHookExW failed — falling back to BlockInput');
      return this.blockInputFallback(true);
    }

    // New hooks are live — now safely unhook and free the old ones
    this.tearDownHooks();

    this.kbHook = newKbHook;
    this.mouseHook = newMouseHook;
    this.kbCallback = newKbCallback;
    this.mouseCallback = newMouseCallback;
    this.locked = true;
    return true;
  }

  removeInputLock(): void {
    this.tearDownHooks();
    this.blockInputFallback(false);
    this.locked = false;
  }

  isInputLocked(): boolean {
    return this.locked;
  }

  replayInput(event: RemoteInputEvent): Promise<void> {
    return this.replay.replayInput(event);
  }

  blockInput(blocked: boolean): boolean {
    return this.blockInputFallback(blocked);
  }

  private blockInputFallback(blocked: boolean): boolean {
    try {
      return Boolean(BlockInput(blocked));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[native-bridge] user32!BlockInput failed', err);
      return false;
    }
  }

  private tearDownHooks(): void {
    if (this.kbHook) {
      try { UnhookWindowsHookEx(this.kbHook); } catch { /* best effort */ }
      this.kbHook = null;
    }
    if (this.mouseHook) {
      try { UnhookWindowsHookEx(this.mouseHook); } catch { /* best effort */ }
      this.mouseHook = null;
    }
    if (this.kbCallback !== null) {
      try { koffi.unregister(this.kbCallback); } catch { /* best effort */ }
      this.kbCallback = null;
    }
    if (this.mouseCallback !== null) {
      try { koffi.unregister(this.mouseCallback); } catch { /* best effort */ }
      this.mouseCallback = null;
    }
  }
}
