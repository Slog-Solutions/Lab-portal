import type { CommandTarget } from '@lab/shared';
import { apiFetch } from './api-client';

/** Thin wrappers over /api/control/* (design doc §4.4 targeting, apps/server
 * ControlController) — one function per classroom-control action so pages
 * never hand-build the request shape. */
export const controlApi = {
  lock: (target: CommandTarget, opts: { screen: boolean; input: boolean; message?: string }) =>
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
};
