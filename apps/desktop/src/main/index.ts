import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, powerMonitor, screen, session, Tray } from 'electron';
import path from 'node:path';
import { loadNativeBridge } from '@lab/native-bridge';
import type { RemoteInputEvent } from '@lab/shared/events';
import { registerAppScheme, handleAppScheme, applyContentSecurityPolicy, APP_SCHEME } from './protocol';
import { ControlClient } from './control-client';
import { LockOverlayManager } from './lock-overlay';
import { SoftLockController } from './soft-lock';
import { executeCommand } from './command-handler';
import { getOrCreateMachineGuid } from './station-identity';
import { resolveRuntimeConfig } from './runtime-config';
import { initUpdater } from './updater';
import { lockWorkstation, resolveEnforce, resolveGraceMs, WorkstationLockController, type NoticeKind } from './workstation-lock';

const DISABLE_OVERLAY_DISCONNECT_FAILSAFE_MS = 30_000; // matches the server's lock-lease timeout

// A minimal 16x16 monitor glyph, inlined so the tray icon needs no asset
// path resolution between `npm run dev` and a packaged app://-scheme build.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR4nGPgF9dioATDGP/JxAgDHr34QBIeNWDUAKwGUJwS0XFKSTcKpp8B6BoJGMSAkT1JxQCHaSlDHKdZIgAAAABJRU5ErkJggg==';

// MUST run before app.whenReady() (design doc §1.4, §2.8).
registerAppScheme();

const isDev = !app.isPackaged;

app.commandLine.appendSwitch('ignore-certificate-errors');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Dev: env vars or localhost:3010/7880 (npm run dev:all). Packaged: env vars
// or userData/config.json — see runtime-config.ts for the one file a lab
// technician edits to point a station at the Docker stack's server IP.
const { serverUrl: SERVER_URL, livekitUrl: LIVEKIT_URL } = resolveRuntimeConfig(app.isPackaged);

let mainWindow: BrowserWindow | null = null;
let controlClient: ControlClient | null = null;
let workstationController: WorkstationLockController | null = null;
let tray: Tray | null = null;
let disableFailsafeTimer: NodeJS.Timeout | undefined;
const lockOverlay = new LockOverlayManager();

// Set only by a real quit (tray Quit, before-quit) — distinguishes that
// from the student closing the window, which now hides to tray instead
// (see mainWindow's 'close' handler below). Without this, LabPortal would
// still be a "quits when the window closes" app in every way that
// matters for "shut down the room from the browser" to actually work.
let isQuitting = false;

// Tracks the three independent reasons the overlay might be up, so a
// single snapshot/notice change can reconcile it in one place instead of
// each caller guessing at the others' state.
let stationEnabled = true;
let noticeKind: NoticeKind = null;
let softLockActive = false;
let lockMessage: string | undefined;

/** The app's own cover shows for "This station has been disabled", for a
 * soft Lock (mode: 'soft' — releasable from the browser, see soft-lock.ts)
 * and, as a fallback, when the real Windows lock can't be confirmed — the
 * Windows-lock path locks Windows directly and never shows this. */
function reconcileOverlay(): void {
  if (!stationEnabled) {
    lockOverlay.show('This station has been disabled by the instructor', { lease: false });
  } else if (softLockActive) {
    lockOverlay.show(lockMessage ?? 'Screen locked by your instructor', { lease: true });
  } else if (noticeKind === 'grace') {
    lockOverlay.show('Locked by your instructor', { lease: true });
  } else if (noticeKind === 'fallback') {
    lockOverlay.show(lockMessage ?? 'Screen locked by instructor', { lease: true });
  } else {
    lockOverlay.hide();
  }
}

// ── Electron-native input lock (spec: electron-input-lock-feature.md) ──────
//
// Single source of truth for whether input is frozen. Both mouse and keyboard
// always stay in sync through this flag (spec §Part 1, §Part 3 last bullet).
//
// Mouse:    win.setIgnoreMouseEvents(true/false)
//           Events pass through the window without affecting it — page keeps
//           rendering normally (spec §Part 4 §1).
// Keyboard: before-input-event → event.preventDefault() when inputLocked.
//           Fires before input reaches the page (spec §Part 1).
//
// Transport: the existing ControlClient WebSocket (Option A — works for both
// same-machine and remote). The server pushes lock/unlock as part of every
// station snapshot; no separate channel is needed (spec §Part 2 §Option A).
//
// Security: authenticated via the existing station JWT (ControlClient handles
// auth); no unauthenticated commands accepted (spec §Part 3 §1).
let inputLocked = false;

function lockInput(): void {
  inputLocked = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(true);
  }
}

function unlockInput(): void {
  inputLocked = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(false);
  }
}

// Real nut.js-backed replay today (verified: moves the actual OS cursor —
// see build session notes); resolves to KoffiNativeBridge's real
// user32!BlockInput automatically once that tier loads (native-bridge's
// loadNativeBridge() tries it before falling back here).
const nativeBridge = loadNativeBridge();

// Dev-only cap: auto-release input locally after this many ms so a
// developer who locks their own PC is never permanently stuck.
// Only applies in non-packaged (dev) builds; packaged builds have no cap.
const DEV_INPUT_LOCK_CAP_MS = Number(process.env.LAB_INPUT_LOCK_DEV_MAX_MS ?? 60_000);

// The soft lock controller. applyInputLock wires to the Electron-native
// lockInput/unlockInput pair above so the single `inputLocked` flag governs
// both mouse and keyboard at all times (spec §Part 1).
const softLock = new SoftLockController({
  applyInputLock: (locked) => {
    if (locked) lockInput();
    else unlockInput();
  },
  setOverlayActive: (active, message) => {
    softLockActive = active;
    if (active) lockMessage = message;
    reconcileOverlay();
  },
  devMaxInputLockMs: isDev ? DEV_INPUT_LOCK_CAP_MS : undefined,
});

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
      devTools: true, // temporarily always-on for debugging
      // Preload has no async top-level (CJS build) so it can't read the
      // persisted machineGuid itself — passed in here instead, the
      // standard Electron pattern for seeding preload config.
      additionalArguments: [`--machine-guid=${machineGuid}`, `--livekit-url=${LIVEKIT_URL}`, `--server-url=${SERVER_URL}`],
    },
  });

  // Keyboard lock: swallow all keyboard input when inputLocked.
  // Registered once at window creation (spec §Part 1). The `inputLocked`
  // module-level flag is the single source of truth shared with lockInput()
  // and unlockInput() so mouse and keyboard always stay in sync.
  mainWindow.webContents.on('before-input-event', (event, _input) => {
    if (inputLocked) event.preventDefault();
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

  // Closing the window now hides it to the tray instead of quitting the
  // app (see the module-scope isQuitting flag) — a closed window used to
  // mean an unreachable PC no matter what the server permitted; this is
  // the fix. A real quit sets isQuitting first, so the default close goes
  // through and 'closed' still fires normally in that case.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    // Window destroyed — reset inputLocked so it doesn't persist if a new
    // window is created (spec §Part 3 §4: "confirm on reload that
    // inputLocked resets to false").
    inputLocked = false;
    mainWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL));
  tray.setToolTip('LabPortal');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance already owns the lock — hand off to it and exit
  // rather than running two agents against the same station identity.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // A real quit — the only place controlClient actually disconnects now
  // (see window-all-closed's removal below) and where the two lock
  // controllers release their OS-level effects before the process exits.
  // unlockInput() here ensures inputLocked resets to false on quit
  // (spec §Part 3 §4: "confirm on app quit that inputLocked resets").
  app.on('before-quit', () => {
    isQuitting = true;
    unlockInput();
    controlClient?.disconnect();
    softLock.destroy();
    workstationController?.destroy();
  });

  app.whenReady().then(async () => {
    const webRoot = path.join(process.resourcesPath, 'web');
    handleAppScheme(webRoot);
    // Report-only for now — see applyContentSecurityPolicy's own doc
    // comment on why this isn't enforcing yet. Session-level (not
    // per-window), so registered once here rather than in createMainWindow.
    applyContentSecurityPolicy(SERVER_URL, LIVEKIT_URL);
    initUpdater(SERVER_URL);

    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    }

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
  //
  // audio: 'loopback' only when the caller actually asked for it
  // (LiveKitRoomClient.setScreenShareEnabled's captureAudio param) — a
  // spotlighted/remote-controlled seat requests video-only, because this
  // same seat is simultaneously PLAYING back the teacher's and other
  // students' voices through this console, and 'loopback' would capture
  // that and echo it back to the whole class.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (sources[0]) callback({ video: sources[0], ...(request.audioRequested ? { audio: 'loopback' } : {}) });
      });
    },
    { useSystemPicker: false },
  );

  const machineGuid = await getOrCreateMachineGuid(app.getPath('userData'));
  createMainWindow(machineGuid);
  createTray();

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
      // snapshot is the whole story, applied idempotently.
      // Input lock: Electron-native setIgnoreMouseEvents + before-input-event
      // (see lockInput/unlockInput above). Transport: this WebSocket
      // connection (Option A from spec — already authenticated).
      stationEnabled = snapshot.stationEnabled;
      lockMessage = snapshot.lock?.message;
      const effectiveLock = stationEnabled ? snapshot.lock : null;
      // Routes on lock.mode (see desired-state.ts): 'windows' drives the
      // real Win+L and never the soft lock; 'soft' (or absent, for a
      // snapshot from an older server) drives the overlay+input-lock path
      // and never the Windows lock. Exactly one of the two is ever active.
      if (effectiveLock?.mode === 'windows') {
        workstationController?.apply(effectiveLock);
        softLock.apply(null);
      } else {
        softLock.apply(effectiveLock);
        workstationController?.apply(null);
      }
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
      softLock.renew();
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
      // Also: if disconnected while input-locked, the 30s failsafe in
      // SoftLockController will self-unlock (spec §Part 3 §3).
      disableFailsafeTimer = setTimeout(() => lockOverlay.hide(), DISABLE_OVERLAY_DISCONNECT_FAILSAFE_MS);
    },
  });
  void controlClient.connect();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(machineGuid);
  });
  });
  // No window-all-closed handler: LabPortal is meant to keep running in
  // the tray once the window is closed (see mainWindow's 'close' handler
  // and createTray above) — Electron does not quit on its own without one
  // registered, which is exactly the always-on behavior this needs. A
  // real quit only ever happens via the tray's Quit item or the OS
  // shutting the process down, both of which go through before-quit.
}
