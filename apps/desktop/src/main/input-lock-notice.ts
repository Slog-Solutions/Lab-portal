import { app, BrowserWindow, screen } from 'electron';

const DEFAULT_MESSAGE = 'Keyboard and mouse locked by your instructor';

/**
 * A small, non-blocking, always-on-top notification banner shown when
 * input is locked but the screen overlay is NOT shown (i.e. the lock has
 * `input: true` and `screen: false`). Mirrors LockOverlayManager's shape
 * but is intentionally unobtrusive:
 *
 *  - Frameless, transparent background, fixed small height at the top-
 *    centre of each display.
 *  - focusable: false — never steals keyboard focus.
 *  - setIgnoreMouseEvents(true) — clicks pass through to whatever is under.
 *  - skipTaskbar — invisible in Alt+Tab / the taskbar.
 *  - Always-on-top at 'screen-saver' level so it stays visible.
 *
 * Lifetime is governed entirely by the caller (soft-lock.ts / index.ts):
 * show() / hide() only. The 30s lease failsafe in SoftLockController
 * already covers input-only locks — no independent failsafe here.
 *
 * Hidden in before-quit so a non-closable notice never blocks app exit.
 */
export class InputLockNotice {
  private windows: BrowserWindow[] = [];

  constructor() {
    app.on('before-quit', () => this.hide());
  }

  get isVisible(): boolean {
    return this.windows.length > 0;
  }

  show(message: string = DEFAULT_MESSAGE): void {
    if (this.isVisible) {
      // Update message in-place if already showing
      this.updateMessage(message);
      return;
    }

    const displays = screen.getAllDisplays();
    this.windows = displays.map((display) => this.createNoticeWindow(display, message));
  }

  hide(): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows = this.windows.filter((win) => !win.isDestroyed());
  }

  private updateMessage(message: string): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents
          .executeJavaScript(
            `document.getElementById('notice-message').textContent = ${JSON.stringify(message)}`,
          )
          .catch(() => {});
      }
    }
  }

  private createNoticeWindow(display: Electron.Display, message: string): BrowserWindow {
    const NOTICE_HEIGHT = 48;
    const NOTICE_WIDTH = 480;
    const x = display.bounds.x + Math.round((display.bounds.width - NOTICE_WIDTH) / 2);
    const y = display.bounds.y + 12;

    const win = new BrowserWindow({
      x,
      y,
      width: NOTICE_WIDTH,
      height: NOTICE_HEIGHT,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(8px);
        border-radius: 8px;
        border: 1px solid rgba(248, 250, 252, 0.12);
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        padding: 0 16px;
        -webkit-app-region: no-drag;
        user-select: none;
      }
      .icon { font-size: 16px; flex-shrink: 0; }
      #notice-message { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style></head><body>
      <span class="icon">⌨️</span>
      <span id="notice-message">${escapeHtml(message)}</span>
      </body></html>`;

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return win;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
