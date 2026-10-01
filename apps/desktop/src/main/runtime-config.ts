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
        serverUrl: 'http://CHANGE-ME-TO-SERVER-IP',
      },
      null,
      2,
    ),
  );
}

/**
 * Resolution order: LAB_SERVER_URL/LAB_LIVEKIT_URL env vars (dev override,
 * unchanged from before this file existed) > userData/config.json (the
 * packaged-app path) > hardcoded dev defaults.
 */
export function resolveRuntimeConfig(isPackaged: boolean): RuntimeConfig {
  if (isPackaged) {
    writeTemplateIfMissing();
    const fileConfig = readConfigFile();
    if (fileConfig.serverUrl && fileConfig.serverUrl !== 'http://CHANGE-ME-TO-SERVER-IP') {
      return { serverUrl: fileConfig.serverUrl, livekitUrl: fileConfig.livekitUrl ?? deriveLivekitUrl(fileConfig.serverUrl) };
    }
  }

  const envServerUrl = process.env.LAB_SERVER_URL;
  if (envServerUrl) {
    return { serverUrl: envServerUrl, livekitUrl: process.env.LAB_LIVEKIT_URL ?? deriveLivekitUrl(envServerUrl) };
  }

  return { serverUrl: DEV_DEFAULT_SERVER_URL, livekitUrl: DEV_DEFAULT_LIVEKIT_URL };
}
