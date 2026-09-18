import { app, BrowserWindow, desktopCapturer, ipcMain, powerMonitor, screen, session } from 'electron';
import path from 'node:path';
import { loadNativeBridge } from '@lab/native-bridge';
import type { RemoteInputEvent } from '@lab/shared/events';
import { registerAppScheme, handleAppScheme, APP_SCHEME } from './protocol';
import { ControlClient } from './control-client';
import { LockOverlayManager } from './lock-overlay';
import { executeCommand } from './command-handler';
import { getOrCreateMachineGuid } from './station-identity';
import { initUpdater } from './updater';
import { lockWorkstation, resolveEnforce, resolveGraceMs, WorkstationLockController, type NoticeKind } from './workstation-lock';

const DISABLE_OVERLAY_DISCONNECT_FAILSAFE_MS = 30_000; // matches the server's lock-lease timeout

// MUST run before app.whenReady() (design doc §1.4, §2.8).
registerAppScheme();

const isDev = !app.isPackaged;
const SERVER_URL = process.env.LAB_SERVER_URL ?? 'http://localhost:3000';
const LIVEKIT_URL = process.env.LAB_LIVEKIT_URL ?? 'ws://localhost:7880';

let mainWindow: BrowserWindow | null = null;
let controlClient: ControlClient | null = null;
let workstationController: WorkstationLockController | null = null;
let disableFailsafeTimer: NodeJS.Timeout | undefined;
const lockOverlay = new LockOverlayManager();

// Tracks the two independent reasons the overlay might be up, so a single
// snapshot/notice change can reconcile it in one place instead of each
// caller guessing at the other's state.
let stationEnabled = true;
let noticeKind: NoticeKind = null;
let lockMessage: string | undefined;

/** The app's own cover is now only for "This station has been disabled"
 * and, as a fallback, when the real Windows lock can't be confirmed —
 * the normal Lock path locks Windows directly and never shows this. */
function reconcileOverlay(): void {
  if (!stationEnabled) {
    lockOverlay.show('This station has been disabled by the instructor', { lease: false });
  } else if (noticeKind === 'grace') {
    lockOverlay.show('Locked by your instructor', { lease: true });
  } else if (noticeKind === 'fallback') {
    lockOverlay.show(lockMessage ?? 'Screen locked by instructor', { lease: true });
  } else {
    lockOverlay.hide();
  }
}

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

  // Drives the real Windows lock (Win+L) — see workstation-lock.ts's doc
  // comment for the full apply/grace/fallback state machine. Created here
  // (not at module scope) because it needs app.isPackaged, which is only
  // meaningful once the app is actually ready.
  workstationController = new WorkstationLockController({
    lockFn: lockWorkstation,
    isOsLocked: () => powerMonitor.getSystemIdleState(1) === 'locked',
    enforce: resolveEnforce(process.env.LAB_LOCK_ENFORCE, app.isPackaged),
    graceMs: resolveGraceMs(process.env.LAB_LOCK_RELOCK_GRACE_MS),
    onNotice: (kind) => {
      noticeKind = kind;
      reconcileOverlay();
    },
  });
  powerMonitor.on('lock-screen', () => workstationController?.onOsLocked());
  powerMonitor.on('unlock-screen', () => workstationController?.onOsUnlocked());

  controlClient = new ControlClient(SERVER_URL, machineGuid, {
    onSnapshot: (snapshot) => {
      // eslint-disable-next-line no-console
      console.log('[main] session:snapshot', snapshot);
      // The client reconciles current-vs-desired (design doc §4.3) — a
      // snapshot is the whole story, applied idempotently. Input lock is
      // a documented gap until native-bridge ships real
      // WH_KEYBOARD_LL/WH_MOUSE_LL hooks.
      stationEnabled = snapshot.stationEnabled;
      lockMessage = snapshot.lock?.message;
      workstationController?.apply(stationEnabled ? snapshot.lock : null);
      reconcileOverlay();
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
      workstationController?.renew();
      lockOverlay.onHeartbeat();
    },
    onConnect: () => {
      if (disableFailsafeTimer) clearTimeout(disableFailsafeTimer);
      disableFailsafeTimer = undefined;
    },
    onDisconnect: () => {
      // The disabled-station cover carries no lock lease to renew (it
      // isn't a lock at all) — this is its own failsafe, matching the
      // same "a crash can never leave a machine covered" property.
      disableFailsafeTimer = setTimeout(() => lockOverlay.hide(), DISABLE_OVERLAY_DISCONNECT_FAILSAFE_MS);
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
