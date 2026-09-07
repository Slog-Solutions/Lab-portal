import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { registerAppScheme, handleAppScheme, APP_SCHEME } from './protocol';
import { ControlClient } from './control-client';
import { LockOverlayManager } from './lock-overlay';
import { executeCommand } from './command-handler';

// MUST run before app.whenReady() (design doc §1.4, §2.8).
registerAppScheme();

const isDev = !app.isPackaged;
const SERVER_URL = process.env.LAB_SERVER_URL ?? 'http://localhost:3000';

let mainWindow: BrowserWindow | null = null;
let controlClient: ControlClient | null = null;
const lockOverlay = new LockOverlayManager();

function createMainWindow(): void {
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
    },
  });

  if (isDev) {
    // Local dev loads the Vite dev server directly for HMR. Packaged
    // builds load app://lab/index.html, which serves the SAME build the
    // browser gets from Nest (design doc §1.4) — see handleAppScheme
    // below and electron-builder.yml's extraResources.
    void mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL(`${APP_SCHEME}://lab/index.html`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const webRoot = path.join(process.resourcesPath, 'web');
  handleAppScheme(webRoot);

  ipcMain.handle('agent:get-app-version', () => app.getVersion());

  createMainWindow();

  controlClient = new ControlClient(SERVER_URL, app.getPath('userData'), {
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
      void executeCommand(envelope).then((result) => {
        controlClient?.ackCommand({ commandId: envelope.id, status: result.status, error: result.error, appliedAt: Date.now() });
      });
    },
    onLockHeartbeat: () => {
      lockOverlay.onHeartbeat();
    },
  });
  void controlClient.connect();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  controlClient?.disconnect();
  if (process.platform !== 'darwin') app.quit();
});
