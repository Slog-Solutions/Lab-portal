import { contextBridge, ipcRenderer } from 'electron';
import type { LabRuntimeConfig } from '../main/station-identity';
import type { RemoteInputEvent } from '@lab/shared/events';

/**
 * The desktop half of the single runtime branch (design doc §1.4):
 * apps/web's runtime-config.ts reads window.__LAB__ and never checks
 * "am I in Electron?" itself. contextIsolation stays on — nothing here
 * hands the renderer raw Node/Electron APIs, only this narrow bridge.
 *
 * machineGuid/livekitUrl/serverUrl arrive via webPreferences.additionalArguments
 * (main/index.ts) rather than being read here directly — this is a CJS
 * preload build with no top-level await, and getOrCreateMachineGuid()
 * is async (reads a file), so the value has to be computed in main and
 * handed down. serverUrl in particular MUST come from main's resolved
 * SERVER_URL (runtime-config.ts) — a second, different hardcoded fallback
 * here (previously https://labserver.lab.local, a prod-only hostname that
 * only resolves on the real lab network) silently diverged from it
 * whenever the arg was somehow missing, sending the renderer's socket.io
 * client into an ERR_NAME_NOT_RESOLVED reconnect loop. The fallback below
 * now matches main's own dev default instead, so the two can never
 * diverge again — in practice main always passes the arg and this branch
 * is dead.
 */
function readArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

contextBridge.exposeInMainWorld('__LAB__', {
  platform: 'desktop',
  serverUrl: readArg('server-url') ?? 'http://localhost:3010',
  stationId: process.env.LAB_STATION_ID,
  machineGuid: readArg('machine-guid'),
  livekitUrl: readArg('livekit-url'),
} satisfies LabRuntimeConfig);

// Narrow, typed surface for capabilities the renderer cannot have
// directly — nothing here widens nodeIntegration.
contextBridge.exposeInMainWorld('__LAB_AGENT__', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('agent:get-app-version'),
  /** Remote-control input replay (design doc §3.4). The renderer receives
   * the LiveKit data-channel event (nut.js/native addons are unreachable
   * from this sandboxed, contextIsolated process) and hands it to main,
   * which actually moves the OS cursor / types the keys. Fire-and-forget
   * by design — input events are high-rate and unreliable-by-choice. */
  replayInput: (event: RemoteInputEvent): void => ipcRenderer.send('agent:replay-input', event),
});
