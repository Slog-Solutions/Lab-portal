import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { sendToAgent } from './agent-client';

/**
 * LAN auto-update (design doc §3.8): `electron-builder.yml`'s `publish`
 * block already points the generic provider at
 * `https://labserver.lab.local/updates/win/` — this wires the client side
 * up to actually use it. Deliberately `autoInstallOnAppQuit: false`: that
 * default would make electron-updater run the installer itself on quit,
 * which for a `perMachine: true` NSIS build means a UAC prompt in front
 * of a student — exactly what the elevated agent's `apply-update` verb
 * exists to avoid (see `services/lab-agent-svc/src/agent-server.ts`'s doc
 * comment). Instead: download automatically, but only ever install via
 * the agent, on an explicit `CommandType.APPLY_UPDATE` from the teacher
 * console — a station never updates itself mid-class unasked.
 *
 * Only active in a packaged build (`app.isPackaged`) — a dev run has no
 * `app-update.yml` (electron-builder generates it at package time from
 * the `publish` config) and would just throw, the same dev/real-deployment
 * split every other environment-dependent piece of this app already draws.
 */
let downloadedInstallerPath: string | null = null;

export function initUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', (info) => {
    downloadedInstallerPath = info.downloadedFile ?? null;
    // eslint-disable-next-line no-console
    console.log(`[updater] downloaded ${info.version} -> ${downloadedInstallerPath}`);
  });
  autoUpdater.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[updater] check/download failed (harmless if this LAN has no /updates/win/ yet)', err);
  });

  void autoUpdater.checkForUpdates();
  // Re-check periodically rather than only at launch — a station that
  // stays powered on for a whole term should still pick up updates
  // published mid-term, not just at next boot.
  setInterval(() => void autoUpdater.checkForUpdates(), 6 * 60 * 60_000);
}

/** `CommandType.APPLY_UPDATE`'s handler — installs whatever
 * `update-downloaded` already staged, via the elevated agent. */
export async function applyDownloadedUpdate(): Promise<{ status: 'applied' | 'failed' | 'ignored'; error?: string }> {
  if (!downloadedInstallerPath) {
    return { status: 'ignored', error: 'No update has been downloaded yet' };
  }
  const res = await sendToAgent('apply-update', { installerPath: downloadedInstallerPath });
  return res.ok ? { status: 'applied' } : { status: 'failed', error: res.error };
}
