import { contextBridge, ipcRenderer } from 'electron';
import type { LabRuntimeConfig } from '../main/station-identity';

/**
 * The desktop half of the single runtime branch (design doc §1.4):
 * apps/web's runtime-config.ts reads window.__LAB__ and never checks
 * "am I in Electron?" itself. contextIsolation stays on — nothing here
 * hands the renderer raw Node/Electron APIs, only this narrow bridge.
 */
contextBridge.exposeInMainWorld('__LAB__', {
  platform: 'desktop',
  serverUrl: process.env.LAB_SERVER_URL ?? 'https://labserver.lab.local',
  stationId: process.env.LAB_STATION_ID,
} satisfies LabRuntimeConfig);

// Narrow, typed surface for capabilities the renderer cannot have
// directly. Empty today; Phase 1's remote-control/lock UI extends this
// (e.g. requesting the local unlock chord's PIN prompt) rather than
// widening nodeIntegration.
contextBridge.exposeInMainWorld('__LAB_AGENT__', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('agent:get-app-version'),
});
