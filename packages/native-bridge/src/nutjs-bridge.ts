import { Button, Key, keyboard, mouse, screen } from '@nut-tree-fork/nut-js';
import type { RemoteInputEvent } from '@lab/shared/events';
import type { NativeBridge } from './types';

/**
 * Real remote-control replay via nut.js (design doc §3.4, build plan
 * "week one spike": nut.js needs no compiler — @nut-tree-fork/libnut-win32
 * ships a prebuilt `.node` binary, verified during this build — so it is
 * usable even though the hook-based lock addon is blocked).
 *
 * installInputLock/removeInputLock/blockInput stay unimplemented here —
 * nut.js has no API for suppressing input, only generating it. Those
 * three remain NotImplementedNativeBridge's job until the real Win32
 * hook addon exists.
 */
export class NutjsNativeBridge implements NativeBridge {
  private locked = false;

  constructor() {
    mouse.config.autoDelayMs = 0;
    keyboard.config.autoDelayMs = 0;
  }

  installInputLock(): boolean {
    // eslint-disable-next-line no-console
    console.warn('[native-bridge] installInputLock() is not implemented by NutjsNativeBridge — nut.js cannot suppress input, only generate it.');
    this.locked = true;
    return false;
  }

  removeInputLock(): void {
    this.locked = false;
  }

  isInputLocked(): boolean {
    return this.locked;
  }

  async replayInput(event: RemoteInputEvent): Promise<void> {
    switch (event.kind) {
      case 'move': {
        const point = await normalizedToScreenPoint(event.x, event.y);
        await mouse.setPosition(point);
        break;
      }
      case 'click': {
        const point = await normalizedToScreenPoint(event.x, event.y);
        await mouse.setPosition(point);
        const btn = event.button === 'left' ? Button.LEFT : event.button === 'right' ? Button.RIGHT : Button.MIDDLE;
        await (event.down ? mouse.pressButton(btn) : mouse.releaseButton(btn));
        break;
      }
      case 'scroll': {
        if (event.deltaY < 0) await mouse.scrollUp(Math.abs(event.deltaY));
        else if (event.deltaY > 0) await mouse.scrollDown(event.deltaY);
        if (event.deltaX < 0) await mouse.scrollLeft(Math.abs(event.deltaX));
        else if (event.deltaX > 0) await mouse.scrollRight(event.deltaX);
        break;
      }
      case 'key': {
        const key = (Key as unknown as Record<string, Key>)[event.keyName];
        if (key === undefined) {
          // eslint-disable-next-line no-console
          console.warn(`[native-bridge] unknown key name from wire: "${event.keyName}" — ignoring, not throwing`);
          break;
        }
        await (event.down ? keyboard.pressKey(key) : keyboard.releaseKey(key));
        break;
      }
      case 'text': {
        await keyboard.type(event.unicodeChar);
        break;
      }
    }
  }

  blockInput(): boolean {
    // eslint-disable-next-line no-console
    console.warn('[native-bridge] blockInput() is not implemented by NutjsNativeBridge — that needs the real Win32 addon.');
    return false;
  }
}

/** nut.js's mouse API takes absolute screen pixels, not the normalized
 * 0..1 coordinates the wire format uses (design doc §3.4's DPI-scaling
 * dodge) — this is the one place that conversion happens. Single-primary-
 * -monitor assumption for v1, matching the rest of this pass's scope. */
async function normalizedToScreenPoint(nx: number, ny: number): Promise<{ x: number; y: number }> {
  const width = await screen.width();
  const height = await screen.height();
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { x: Math.round(clamp(nx) * width), y: Math.round(clamp(ny) * height) };
}
