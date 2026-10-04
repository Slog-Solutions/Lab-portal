import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RuntimeConfig {
  serverUrl: string;
  livekitUrl: string;
}

interface ConfigFile {
  serverUrl?: string;
  livekitUrl?: string;
}

// Matches the un-dockerized dev server (npm run dev:all) — never used for a
// packaged build once a station has been pointed at a real server (see
// writeTemplateIfMissing's placeholder below).
const DEV_DEFAULT_SERVER_URL = 'http://localhost:3010';
const DEV_DEFAULT_LIVEKIT_URL = 'ws://localhost:7880';
const PLACEHOLDER_SERVER_URL = 'http://CHANGE-ME-TO-SERVER-IP';

/**
 * Mirrors apps/web/docker/40-runtime-config.sh's window.__LAB__.livekitUrl:
 * LiveKit signalling rides through nginx at /livekit on the SAME origin as
 * the API (docker-compose.yml's `web` service), so a station only ever
 * needs to be told one address.
 */
function deriveLivekitUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${url.host}/livekit`;
}

/**
 * The ONE file a lab technician edits to point a packaged station at the
 * Docker stack (docker-compose.yml's `web` service, i.e. HOST_IP/HTTP_PORT
 * from that machine's .env) — there is no settings UI. Lives in userData
 * (same place as station.json) so writing it never needs admin rights,
 * unlike a file under Program Files (this app installs perMachine).
 */
function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfigFile(): ConfigFile {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf-8')) as ConfigFile;
  } catch {
    return {};
  }
}

function writeTemplateIfMissing(): void {
  const file = configPath();
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        _comment:
          "Set serverUrl to the lab server's address, e.g. http://192.168.131.1 " +
          "(the Docker host's HOST_IP:HTTP_PORT from its .env — see docker-compose.yml). " +
          'Restart LabPortal after editing. livekitUrl is optional; derived from ' +
          'serverUrl + /livekit when omitted.',
        serverUrl: PLACEHOLDER_SERVER_URL,
      },
      null,
      2,
    ),
  );
}

/**
 * The server address baked into this installer at build time
 * (build/server-config.json, shipped via electron-builder's extraResources),
 * so a fresh install connects with no per-station step. Absent or empty
 * serverUrl means "not baked" — the placeholder flow above still applies.
 */
function readBundledConfig(): ConfigFile {
  try {
    return JSON.parse(readFileSync(path.join(process.resourcesPath, 'server-config.json'), 'utf-8')) as ConfigFile;
  } catch {
    return {};
  }
}

function isUsableServerUrl(url: string | undefined): url is string {
  return !!url && url !== PLACEHOLDER_SERVER_URL;
}

/** Records which bundled address this user profile has already applied. */
function seenMarkerPath(): string {
  return path.join(app.getPath('userData'), 'installer-server.json');
}

function readSeenBundledUrl(): string | undefined {
  try {
    return (JSON.parse(readFileSync(seenMarkerPath(), 'utf-8')) as { serverUrl?: string }).serverUrl;
  } catch {
    return undefined;
  }
}

/**
 * A (re)install that brings a server address this profile has not seen yet
 * overwrites config.json with it, once. Without this, a PC that was ever
 * pointed elsewhere (an earlier install, set-server-ip.ps1) keeps its stale
 * config.json forever, because config.json outranks the bundled address.
 *
 * Done here rather than in the NSIS installer on purpose: config.json is
 * per Windows user, and an elevated installer frequently runs as a different
 * (admin) account than the student who uses the PC, so it would fix the wrong
 * profile. The app always runs as the right user.
 *
 * After this runs, the marker matches, so a later set-server-ip.ps1 re-point
 * is respected until an installer ships a different address.
 */
function applyNewBundledAddress(): void {
  const bundled = readBundledConfig();
  if (!isUsableServerUrl(bundled.serverUrl) || readSeenBundledUrl() === bundled.serverUrl) return;
  try {
    mkdirSync(path.dirname(configPath()), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify(
        {
          _comment: 'Set from the installer. Re-point with set-server-ip.ps1 if needed.',
          serverUrl: bundled.serverUrl,
          ...(bundled.livekitUrl ? { livekitUrl: bundled.livekitUrl } : {}),
        },
        null,
        2,
      ),
    );
    writeFileSync(seenMarkerPath(), JSON.stringify({ serverUrl: bundled.serverUrl }, null, 2));
  } catch {
    // Unwritable profile: the bundled address still applies whenever
    // config.json is absent or a placeholder, so this only loses the override.
  }
}

/**
 * Resolution order (packaged): a newly installed bundled address is first
 * copied into config.json (applyNewBundledAddress). Then userData/config.json
 * (set-server-ip.ps1 or a hand edit) > the installer's bundled
 * server-config.json. Then LAB_SERVER_URL/LAB_LIVEKIT_URL env vars (dev
 * override) > hardcoded dev defaults.
 */
export function resolveRuntimeConfig(isPackaged: boolean): RuntimeConfig {
  if (isPackaged) {
    applyNewBundledAddress();
    writeTemplateIfMissing();
    for (const fileConfig of [readConfigFile(), readBundledConfig()]) {
      if (isUsableServerUrl(fileConfig.serverUrl)) {
        return { serverUrl: fileConfig.serverUrl, livekitUrl: fileConfig.livekitUrl ?? deriveLivekitUrl(fileConfig.serverUrl) };
      }
    }
  }

  const envServerUrl = process.env.LAB_SERVER_URL;
  if (envServerUrl) {
    return { serverUrl: envServerUrl, livekitUrl: process.env.LAB_LIVEKIT_URL ?? deriveLivekitUrl(envServerUrl) };
  }

  return { serverUrl: DEV_DEFAULT_SERVER_URL, livekitUrl: DEV_DEFAULT_LIVEKIT_URL };
}
