import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron';
import path from 'node:path';
import { loadNativeBridge } from '@lab/native-bridge';
import type { RemoteInputEvent } from '@lab/shared/events';
import { registerAppScheme, handleAppScheme, APP_SCHEME } from './protocol';
import { ControlClient } from './control-client';
import { LockOverlayManager } from './lock-overlay';
import { executeCommand } from './command-handler';
import { getOrCreateMachineGuid } from './station-identity';
import { initUpdater } from './updater';

// MUST run before app.whenReady() (design doc §1.4, §2.8).
registerAppScheme();

const isDev = !app.isPackaged;
const SERVER_URL = process.env.LAB_SERVER_URL ?? 'http://localhost:3000';
const LIVEKIT_URL = process.env.LAB_LIVEKIT_URL ?? 'ws://localhost:7880';

let mainWindow: BrowserWindow | null = null;
let controlClient: ControlClient | null = null;
const lockOverlay = new LockOverlayManager();
// Real nut.js-backed replay today (verified: moves the actual OS cursor —
// see build session notes); resolves to the real Win32 hook addon
// automatically once that exists (native-bridge's loadNativeBridge()
// tries it first). See build plan "week one spike" for why the hook
// addon itself isn't built yet.
const nativeBridge = loadNativeBridge();

function createMainWindow(machineGuid: string): void {
  const primaryDisplay = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    width: primaryDisplay.workAreaSize.width,
    height: primaryDisplay.workAreaSize.height,
    // Kiosk/lock hardening (design doc §3.8) lands with the native-bridge
    // integration in Phase 1 — this establishes the intended posture now
    // so the webPreferences contract doesn't shift later.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
      // Preload has no async top-level (CJS build) so it can't read the
      // persisted machineGuid itself — passed in here instead, the
      // standard Electron pattern for seeding preload config.
      additionalArguments: [`--machine-guid=${machineGuid}`, `--livekit-url=${LIVEKIT_URL}`, `--server-url=${SERVER_URL}`],
    },
  });

  if (isDev) {
    // Local dev loads the Vite dev server directly for HMR. Packaged
    // builds load app://lab/index.html, which serves the SAME build the
    // browser gets from Nest (design doc §1.4) — see handleAppScheme
    // below and electron-builder.yml's extraResources.
    void mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    // DEBUG: forward renderer console output to the main process's own
    // stdout — there is no other way to see it from a headless launch.
    mainWindow.webContents.on('console-message', (event) => {
      // eslint-disable-next-line no-console
      console.log(`[renderer] ${event.message}`);
    });
  } else {
    void mainWindow.loadURL(`${APP_SCHEME}://lab/index.html`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const webRoot = path.join(process.resourcesPath, 'web');
  handleAppScheme(webRoot);
  initUpdater();

  ipcMain.handle('agent:get-app-version', () => app.getVersion());
  // Remote-control input replay (design doc §3.4) — the renderer receives
  // LiveKit data-channel events (it must, since nut.js/native addons are
  // unreachable from a sandboxed, contextIsolated renderer) and forwards
  // them here, where the real OS-level replay happens.
  ipcMain.on('agent:replay-input', (_event, payload: RemoteInputEvent) => {
    void nativeBridge.replayInput(payload).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[main] replayInput failed', err);
    });
  });

  // Auto-resolves getDisplayMedia with NO OS picker dialog — required
  // for a kiosk seat: neither the teacher's broadcast nor a
  // teacher-promoted student screen-share should ever wait on a student
  // clicking through a "share your screen?" prompt. Always grabs the
  // primary display; per-window/multi-monitor selection is a Phase 2+
  // teacher-facing control, not something the student picks themselves.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (sources[0]) callback({ video: sources[0], audio: 'loopback' });
      });
    },
    { useSystemPicker: false },
  );

  const machineGuid = await getOrCreateMachineGuid(app.getPath('userData'));
  createMainWindow(machineGuid);

  controlClient = new ControlClient(SERVER_URL, machineGuid, {
    onSnapshot: (snapshot) => {
      // eslint-disable-next-line no-console
      console.log('[main] session:snapshot', snapshot);
      // The client reconciles current-vs-desired (design doc §4.3) — a
      // snapshot is the whole story, applied idempotently. Screen lock is
      // the only piece implemented today (pure Electron API, no native
      // hooks needed); input lock is a documented gap until native-bridge
      // ships real WH_KEYBOARD_LL/WH_MOUSE_LL hooks.
      if (!snapshot.stationEnabled) {
        lockOverlay.show('This station has been disabled by the instructor');
      } else if (snapshot.lock?.screen) {
        lockOverlay.show(snapshot.lock.message);
      } else {
        lockOverlay.hide();
      }
      // TODO(Phase 1 UI): forward the full snapshot to the renderer via
      // mainWindow.webContents.send once the student console reads
      // activity/media state from it, rather than only the main process.
    },
    onIdentity: (identity) => {
      // eslint-disable-next-line no-console
      console.log('[main] station:identity', identity);
    },
    onCommand: (envelope) => {
      void executeCommand(envelope, { serverUrl: SERVER_URL, getToken: () => controlClient?.getToken() ?? null }).then((result) => {
        controlClient?.ackCommand({ commandId: envelope.id, status: result.status, error: result.error, appliedAt: Date.now() });
      });
    },
    onLockHeartbeat: () => {
      lockOverlay.onHeartbeat();
    },
  });
  void controlClient.connect();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(machineGuid);
  });
});

app.on('window-all-closed', () => {
  controlClient?.disconnect();
  if (process.platform !== 'darwin') app.quit();
});
