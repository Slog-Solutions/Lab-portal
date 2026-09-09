import type { NativeBridge } from './types';
import { NotImplementedNativeBridge } from './types';
import { NutjsNativeBridge } from './nutjs-bridge';

export type { NativeBridge };
export { NutjsNativeBridge } from './nutjs-bridge';

/**
 * Three-tier resolution, poorest-first-checked so each tier's absence is
 * cheap to detect:
 *  1. The real Win32 hook addon (`prebuilds/win32-x64/lab_native.node`)
 *     — gives BOTH input-lock and replay via raw SendInput. Doesn't
 *     exist yet (blocked on the native build toolchain — see build plan
 *     "week one spike"), so this always falls through today.
 *  2. NutjsNativeBridge — real remote-control replay (verified: nut.js's
 *     libnut-win32 ships a prebuilt .node binary, no compiler needed),
 *     but cannot lock input (nut.js only generates input, never
 *     suppresses it).
 *  3. NotImplementedNativeBridge — neither works; used only if nut.js
 *     itself somehow fails to load (e.g. platform mismatch).
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
    return new NutjsNativeBridge();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[native-bridge] NutjsNativeBridge failed to load, falling back to the no-op stub', err);
    return new NotImplementedNativeBridge();
  }
}
