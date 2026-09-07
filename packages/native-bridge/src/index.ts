import type { NativeBridge } from './types';
import { NotImplementedNativeBridge } from './types';

export type { NativeBridge };

/**
 * Resolves the real prebuilt addon once packages/native-bridge/prebuilds/
 * win32-x64/lab_native.node exists (Phase 1). Falls back to the
 * no-op stub so apps/desktop can be developed and typechecked today
 * without the native build toolchain installed.
 */
export function loadNativeBridge(): NativeBridge {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const native = require('../prebuilds/win32-x64/lab_native.node');
    return native as NativeBridge;
  } catch {
    return new NotImplementedNativeBridge();
  }
}
