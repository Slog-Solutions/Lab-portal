# Feature: Remote Input Lock for Electron App

## Goal
Add the ability to remotely tell the Electron app to **freeze mouse and keyboard input** while keeping the screen rendering exactly as-is (no blur, no minimize, no repaint change). A second command must **unlock** input again.

This is triggered from an external source (e.g. the website / a backend), not from a button inside the Electron app itself.

---

## Part 1 — Input locking in the main process

In the Electron **main** process, implement two functions:

```js
let inputLocked = false;

function lockInput(win) {
  inputLocked = true;
  win.setIgnoreMouseEvents(true);
}

function unlockInput(win) {
  inputLocked = false;
  win.setIgnoreMouseEvents(false);
}
```

Register a keyboard interceptor on the window's `webContents` (do this once, at window creation):

```js
win.webContents.on('before-input-event', (event, input) => {
  if (inputLocked) event.preventDefault();
});
```

Notes:
- `setIgnoreMouseEvents(true)` makes mouse events pass through the window without affecting it — the page keeps rendering normally.
- `before-input-event` fires for keyboard input before it reaches the page; calling `event.preventDefault()` swallows it.
- Both must be wired to the **same** `inputLocked` flag so lock/unlock always stay in sync.

---

## Part 2 — Receiving the remote command

The Electron app needs a channel to receive "lock" / "unlock" commands from outside the app.

**Chosen transport:** _(fill in — WebSocket client connecting to our backend / local HTTP server / other)_

### Option A: WebSocket client (recommended if website and Electron app are on different machines)
- Electron app's main process opens a WebSocket connection to a backend server on startup (and reconnects on drop).
- Backend relays "lock" / "unlock" messages from the website to the connected Electron client(s).
- On receiving a message, main process calls `lockInput(win)` or `unlockInput(win)`.

### Option B: Local HTTP/WebSocket server inside Electron (only works if the sender is on the same machine)
- Main process starts a small local server (e.g. on `127.0.0.1:PORT`) when the app launches.
- Website or local script sends a request (e.g. `POST /lock`, `POST /unlock`) to that port.
- Server handler calls `lockInput(win)` / `unlockInput(win)`.

> Pick one option based on deployment: same machine vs. remote. If unclear, default to Option A since it also works for same-machine setups.

---

## Part 3 — Security / correctness requirements

- [ ] Command channel must be authenticated (token, shared secret, or session-based) — do not accept unauthenticated lock/unlock commands from arbitrary sources.
- [ ] If the app has multiple windows, decide whether lock applies to all windows or a specific one; implement accordingly.
- [ ] Handle reconnect/retry gracefully if using a WebSocket — the app should not stay "stuck" locked if connection drops. Consider an auto-unlock timeout as a safety fallback (e.g. auto-unlock after N minutes if no explicit unlock is received).
- [ ] Confirm on app quit/reload that `inputLocked` resets to `false` and doesn't persist across restarts.
- [ ] Test on Windows/macOS/Linux as applicable — `setIgnoreMouseEvents` behavior can vary slightly by platform.

---

## Part 4 — Testing checklist

- [ ] Send lock command → verify mouse clicks/movement have no effect on the page, but page keeps rendering/updating (e.g. a live clock or animation should keep moving).
- [ ] Send lock command → verify keyboard input (including OS-level shortcuts routed through the page, if applicable) is ignored.
- [ ] Send unlock command → verify mouse and keyboard immediately work again.
- [ ] Verify screen does not blur, minimize, or visually change on lock/unlock — only input handling changes.
- [ ] Verify behavior when the command channel disconnects while locked (define expected fallback behavior — see safety timeout above).

---

## Open questions for implementer
1. Same machine or remote control? (decides Option A vs B above)
2. Does an existing backend already exist that both the website and Electron app can talk to, or does one need to be created?
3. Should the lock indicator be visible to the user in any way (e.g. small overlay icon), or fully invisible?
