import { applyGpoPolicies } from './gpo-policies.js';
import { startAgentServer } from './agent-server.js';
import { rotateToken } from './token-store.js';
import { ensureAllowlistFile } from './allowlist.js';

const REASSERT_INTERVAL_MS = 5 * 60_000;
const APP_NAME = 'LabPortal'; // matches apps/desktop/electron-builder.yml's productName

/**
 * What LabAgentSvc actually runs once installed (service.ts wraps this
 * as the Windows service body via node-windows). The install-time-only
 * actions (root CA import, firewall rule, the GPO values' first write)
 * happen once in install.ts — this loop is the reason a *service* is
 * worth having at all rather than a one-shot installer script: it
 * periodically re-applies the input-lock GPO values, so a student (or
 * anything running with enough privilege in their session) reverting
 * DisableTaskMgr etc. gets it reasserted within one interval rather than
 * permanently, closing the gap silently until the next full re-install.
 *
 * Phase 5 adds the closed-verb-set IPC surface (`agent-server.ts`) as the
 * other reason this needs to be a long-running service rather than an
 * install-time script: shutdown/restart/launch/apply-update all need a
 * listener that outlives any one Electron session.
 */
export function runDaemon(): void {
  applyGpoPolicies();
  setInterval(() => {
    try {
      applyGpoPolicies();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lab-agent-svc] failed to reassert GPO policies', err);
    }
  }, REASSERT_INTERVAL_MS);

  ensureAllowlistFile();
  rotateToken();
  startAgentServer(APP_NAME);
}
