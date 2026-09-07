/**
 * The single runtime branch between hosts (design doc §1.4). Electron's
 * preload script sets window.__LAB__ via contextBridge before this module
 * ever runs; the browser gets an equivalent object from Nest's /config.js.
 * Everything downstream (api-client, socket connection) reads this and
 * never checks "am I in Electron?" directly.
 */
export interface LabRuntimeConfig {
  platform: 'web' | 'desktop';
  serverUrl: string;
  stationId?: string;
}

declare global {
  interface Window {
    __LAB__?: LabRuntimeConfig;
  }
}

export function getRuntimeConfig(): LabRuntimeConfig {
  if (window.__LAB__) return window.__LAB__;
  // Dev fallback: vite's proxy (vite.config.ts) forwards /api and
  // /socket.io to the Nest server, so same-origin works without a
  // separate /config.js in local development.
  return { platform: 'web', serverUrl: window.location.origin };
}
