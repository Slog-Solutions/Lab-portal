import type { CommandTarget } from '@lab/shared';
import { apiFetch } from './api-client';

/** Thin wrappers over /api/control/* (design doc §4.4 targeting, apps/server
 * ControlController) — one function per classroom-control action so pages
 * never hand-build the request shape. */
export const controlApi = {
  /** `mode` defaults server-side to 'soft' (overlay + OS input suppression,
   * releasable from the browser) when omitted — pass 'windows' for the
   * real Win+L, which only the student's own Windows password releases. */
  lock: (target: CommandTarget, opts: { mode?: 'soft' | 'windows'; screen: boolean; input: boolean; message?: string }) =>
    apiFetch('/control/lock', { method: 'POST', body: JSON.stringify({ target, ...opts }) }),
  unlock: (target: CommandTarget) => apiFetch('/control/unlock', { method: 'POST', body: JSON.stringify({ target }) }),
  shutdown: (target: CommandTarget) => apiFetch('/control/shutdown', { method: 'POST', body: JSON.stringify({ target }) }),
  restart: (target: CommandTarget) => apiFetch('/control/restart', { method: 'POST', body: JSON.stringify({ target }) }),
  wake: (target: CommandTarget) => apiFetch('/control/wake', { method: 'POST', body: JSON.stringify({ target }) }),
  message: (target: CommandTarget, text: string, severity: 'info' | 'warning' = 'info') =>
    apiFetch('/control/message', { method: 'POST', body: JSON.stringify({ target, text, severity }) }),
  enable: (target: CommandTarget) => apiFetch('/control/enable', { method: 'POST', body: JSON.stringify({ target }) }),
  disable: (target: CommandTarget) => apiFetch('/control/disable', { method: 'POST', body: JSON.stringify({ target }) }),
  openUrl: (target: CommandTarget, url: string) => apiFetch('/control/open-url', { method: 'POST', body: JSON.stringify({ target, url }) }),
  launchProgram: (target: CommandTarget, programId: string) =>
    apiFetch('/control/launch-program', { method: 'POST', body: JSON.stringify({ target, programId }) }),
  pushFile: (target: CommandTarget, assetId: string, destinationHint: 'desktop' | 'downloads' = 'downloads') =>
    apiFetch('/control/push-file', { method: 'POST', body: JSON.stringify({ target, assetId, destinationHint }) }),
  /** Ser 1 "broadcast any student's screen to others" — spotlights one
   * student's screen to the whole class. `mic` is a separate toggle (a
   * second promoteScreen call with a different `mic` value re-applies it
   * without touching who's presenting). */
  promoteScreen: (stationId: string, mic = false) =>
    apiFetch<{ room: string; viewerToken: string }>('/control/promote-screen', {
      method: 'POST',
      body: JSON.stringify({ stationId, mic }),
    }),
  revokeScreen: (stationId: string) => apiFetch('/control/revoke-screen', { method: 'POST', body: JSON.stringify({ stationId }) }),
};
