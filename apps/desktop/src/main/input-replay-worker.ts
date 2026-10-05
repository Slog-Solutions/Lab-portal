/**
 * Replays the teacher's remote-control input, in an Electron utility process.
 *
 * Why a separate process: pressing a window's caption button (minimize,
 * maximize, close) or grabbing its title bar puts Windows into a modal
 * tracking loop on THAT window's UI thread, waiting for the button release.
 * Injected from LabPortal's own main process, the release had to come from
 * the very thread stuck in that loop, so the teacher could minimize, move or
 * close every window on the student's PC except LabPortal itself. Measured:
 * the same press/release at LabPortal's minimize button minimized it when
 * injected from another process and did nothing when injected from main.
 */
import type { RemoteInputEvent } from '@lab/shared/events';
import { loadNativeBridge } from '@lab/native-bridge';

const bridge = loadNativeBridge();

// Serialised: a press must land before its release, and a move before the
// click that follows it.
let queue: Promise<void> = Promise.resolve();

process.parentPort.on('message', (message) => {
  const event = message.data as RemoteInputEvent;
  queue = queue
    .then(() => bridge.replayInput(event))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[input-replay] replayInput failed', err);
    });
});
