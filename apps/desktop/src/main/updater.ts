import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { sendToAgent } from './agent-client';

/**
 * LAN auto-update (design doc §3.8): `electron-builder.yml`'s `publish`
 * block bakes in a placeholder generic-provider URL
 * (`https://labserver.lab.local/updates/win/`) at build time, since the
 * real server address isn't known until deployment — setFeedURL below
 * overrides it at runtime with the SAME server address the station was
 * actually pointed at (runtime-config.ts), so the update feed always
 * follows wherever LAB_SERVER_URL / userData/config.json says the server
 * is, with no DNS entry for "labserver.lab.local" ever required.
 * Deliberately `autoInstallOnAppQuit: false`: that
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

export function initUpdater(serverUrl: string): void {
  if (!app.isPackaged) return;

  autoUpdater.setFeedURL({ provider: 'generic', url: `${serverUrl}/updates/win/` });
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
