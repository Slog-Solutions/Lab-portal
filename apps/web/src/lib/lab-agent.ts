import type { RemoteInputEvent } from '@lab/shared/events';

/** The narrow bridge Electron's preload exposes (apps/desktop/src/preload)
 * — undefined in a plain browser, where there is no real OS to control. */
interface LabAgent {
  getAppVersion: () => Promise<string>;
  replayInput: (event: RemoteInputEvent) => void;
}

declare global {
  interface Window {
    __LAB_AGENT__?: LabAgent;
  }
}

/** No-ops outside Electron (dev/test in a plain browser has no OS-level
 * cursor to move) rather than throwing — the caller doesn't need to know
 * which host it's running in. */
export function replayInputIfDesktop(event: RemoteInputEvent): void {
  window.__LAB_AGENT__?.replayInput(event);
}
