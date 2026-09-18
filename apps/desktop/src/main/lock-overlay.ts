import { app, BrowserWindow, screen } from 'electron';

const REASSERT_INTERVAL_MS = 250; // design doc §3.1 — another topmost window can always steal the band
const FAILSAFE_GRACE_MS = 30_000; // design doc §3.3 — matches the server's lock-lease timeout exactly

/**
 * App-level cover overlay: one full-screen always-on-top BrowserWindow
 * per display. Used today for "This station has been disabled" and, as a
 * fallback, when the real Windows lock (see workstation-lock.ts) can't be
 * confirmed. This is pure Electron API — no native hooks required, so it
 * works today even with native-bridge stubbed. What it does NOT do
 * (documented limitation, native-bridge is Phase 1+ follow-up): block
 * keyboard/mouse input at the OS level. The overlay captures focus and
 * covers the screen, but Alt+Tab / Win key can still switch away from it
 * without WH_KEYBOARD_LL hooks in place.
 *
 * The failsafe (design doc §3.3, "the most important safety property"):
 * this class does NOT independently decide to unlock. A *leased* show()
 * only ever closes when told to OR when the server stops renewing the
 * lock lease within FAILSAFE_GRACE_MS of the last lock:heartbeat —
 * matching "a crash can never leave a machine locked" without requiring
 * any unlock code path to actually run. An unleased show() (the Disable
 * cover) has no lock:heartbeat to renew it — its own failsafe is index.ts
 * hiding it after 30s of control-socket disconnection.
 *
 * Windows silently no-ops BrowserWindow#close() on a `closable: false`
 * window — hide() used to call close() and then unconditionally forget
 * the windows anyway, leaving them on screen with nothing tracking them.
 * destroy() bypasses that entirely, and hide() only forgets windows that
 * actually report destroyed, so a failed destroy is retried next time.
 */
export class LockOverlayManager {
  private windows: BrowserWindow[] = [];
  private failsafeTimer?: NodeJS.Timeout;
  private reassertTimer?: NodeJS.Timeout;
  private leased = false;

  constructor() {
    // Windows must never block quitting on a non-closable, always-on-top
    // window it forgot how to close.
    app.on('before-quit', () => this.hide());
  }

  get isLocked(): boolean {
    return this.windows.length > 0;
  }

  show(message: string | undefined, { lease }: { lease: boolean }): void {
    this.leased = lease;
    if (this.isLocked) {
      this.updateMessage(message);
      if (lease) this.armFailsafe();
      else this.clearFailsafe();
      return;
    }

    const displays = screen.getAllDisplays();
    this.windows = displays.map((display) => this.createOverlayWindow(display, message));

    this.reassertTimer = setInterval(() => {
      for (const win of this.windows) {
        if (win.isDestroyed()) continue;
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      }
    }, REASSERT_INTERVAL_MS);

    if (lease) this.armFailsafe();
  }

  hide(): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.destroy();
    }
    // Only forget windows that actually report destroyed — a window that
    // somehow survives destroy() stays tracked so a later hide() (or the
    // reassert timer, left running below) can still find it.
    this.windows = this.windows.filter((win) => !win.isDestroyed());
    if (this.windows.length === 0) {
      if (this.reassertTimer) clearInterval(this.reassertTimer);
      this.reassertTimer = undefined;
    }
    this.clearFailsafe();
  }

  /** Called on every server lock:heartbeat — renews the failsafe window,
   * only meaningful for a leased (real-lock fallback) overlay. */
  onHeartbeat(): void {
    if (this.isLocked && this.leased) this.armFailsafe();
  }

  private armFailsafe(): void {
    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    this.failsafeTimer = setTimeout(() => {
      // No renewal within the grace window — server is gone, crashed, or
      // the network dropped. Self-unlock. No teacher action required.
      this.hide();
    }, FAILSAFE_GRACE_MS);
  }

  private clearFailsafe(): void {
    if (this.failsafeTimer) clearTimeout(this.failsafeTimer);
    this.failsafeTimer = undefined;
  }

  private updateMessage(message?: string): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.executeJavaScript(
          `document.getElementById('lock-message').textContent = ${JSON.stringify(message ?? 'Screen locked by instructor')}`,
        ).catch(() => {});
      }
    }
  }

  private createOverlayWindow(display: Electron.Display, message?: string): BrowserWindow {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: true,
      kiosk: true,
      frame: false,
      skipTaskbar: true,
      closable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center}
      #lock-message{font-size:1.5rem;font-weight:600}
      .icon{font-size:3rem;margin-bottom:1rem}
      </style></head><body><div><div class="icon">&#128274;</div>
      <div id="lock-message">${escapeHtml(message ?? 'Screen locked by instructor')}</div></div></body></html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return win;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
