import type { NativeBridge } from './types';
import { NotImplementedNativeBridge } from './types';
import { NutjsNativeBridge } from './nutjs-bridge';

export type { NativeBridge };
export { NutjsNativeBridge } from './nutjs-bridge';
// KoffiNativeBridge is deliberately NOT statically exported here: its
// module top level calls koffi.load('user32.dll'), which throws outright
// on a non-Windows host or a missing prebuilt binary. loadNativeBridge()
// below reaches it only via a dynamic require() inside a try/catch, same
// as the lab_native.node addon tier — a static export would defeat that
// and break importing this package at all on the wrong platform.

/**
 * Four-tier resolution, poorest-first-checked so each tier's absence is
 * cheap to detect:
 *  1. The real Win32 hook addon (`prebuilds/win32-x64/lab_native.node`)
 *     — gives BOTH input-lock and replay via raw SendInput. Doesn't
 *     exist yet (blocked on the native build toolchain — see build plan
 *     "week one spike"), so this always falls through today.
 *  2. KoffiNativeBridge — real OS-level input suppression via
 *     user32!BlockInput through koffi's FFI (ships a prebuilt win32-x64
 *     binary, no C++ toolchain needed), composed with NutjsNativeBridge
 *     for replay. See koffi-bridge.ts's doc comment for BlockInput's
 *     documented limits (released by Ctrl+Alt+Del; unverified on a
 *     standard-user process).
 *  3. NutjsNativeBridge — real remote-control replay (verified: nut.js's
 *     libnut-win32 ships a prebuilt .node binary, no compiler needed),
 *     but cannot lock input (nut.js only generates input, never
 *     suppresses it) — reached only if koffi itself fails to load (wrong
 *     platform, missing prebuilt binary).
 *  4. NotImplementedNativeBridge — neither works; used only if nut.js
 *     itself somehow fails to load too (e.g. platform mismatch).
 */
export function loadNativeBridge(): NativeBridge {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const native = require('../prebuilds/win32-x64/lab_native.node');
    return native as NativeBridge;
  } catch {
    // Expected until the hook addon is built — fall through, not an error.
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KoffiNativeBridge } = require('./koffi-bridge');
    return new KoffiNativeBridge();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[native-bridge] KoffiNativeBridge unavailable, falling back to nut.js (no OS-level input suppression)', err);
  }
  try {
    return new NutjsNativeBridge();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[native-bridge] NutjsNativeBridge failed to load, falling back to the no-op stub', err);
    return new NotImplementedNativeBridge();
  }
}
