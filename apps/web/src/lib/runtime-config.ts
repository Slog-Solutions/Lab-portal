import type { LabRuntimeConfig } from '@lab/shared';

export type { LabRuntimeConfig };

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

export function getLiveKitUrl(): string {
  return getRuntimeConfig().livekitUrl ?? 'ws://localhost:7880';
}

const BROWSER_MACHINE_GUID_KEY = 'lab-browser-machine-guid';

/** Browser/dev-only station identity — see LabRuntimeConfig.machineGuid's
 * doc comment in @lab/shared. */
export function getOrCreateBrowserMachineGuid(): string {
  const config = getRuntimeConfig();
  if (config.machineGuid) return config.machineGuid;

  let guid = localStorage.getItem(BROWSER_MACHINE_GUID_KEY);
  if (!guid) {
    guid = crypto.randomUUID();
    localStorage.setItem(BROWSER_MACHINE_GUID_KEY, guid);
  }
  return guid;
}
