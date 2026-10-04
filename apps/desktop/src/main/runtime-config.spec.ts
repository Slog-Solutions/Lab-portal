import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRuntimeConfig } from './runtime-config';

let userData = '';
let resources = '';

vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const VPS = 'http://72.60.204.211:8057';
const OLD_LAN = 'http://192.168.1.22';

function bake(serverUrl: string): void {
  writeFileSync(path.join(resources, 'server-config.json'), JSON.stringify({ serverUrl }));
}

function userConfig(): { serverUrl?: string } {
  return JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf-8'));
}

// No module state: every call re-reads both files, like a fresh app start.
async function resolve() {
  return resolveRuntimeConfig(true);
}

describe('resolveRuntimeConfig (packaged)', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'lab-userdata-'));
    resources = mkdtempSync(path.join(tmpdir(), 'lab-resources-'));
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
  });

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
    rmSync(resources, { recursive: true, force: true });
  });

  it('a fresh install connects to the baked address', async () => {
    bake(VPS);
    expect((await resolve()).serverUrl).toBe(VPS);
    expect((await resolve()).livekitUrl).toBe('ws://72.60.204.211:8057/livekit');
  });

  it('installing overrides a stale config.json left by an earlier setup', async () => {
    writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ serverUrl: OLD_LAN }));
    bake(VPS);

    expect((await resolve()).serverUrl).toBe(VPS);
    expect(userConfig().serverUrl).toBe(VPS);
  });

  it('a manual re-point after install is kept across restarts', async () => {
    bake(VPS);
    await resolve(); // first start after install applies the baked address

    // set-server-ip.ps1 points this station somewhere else.
    writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ serverUrl: OLD_LAN }));

    expect((await resolve()).serverUrl).toBe(OLD_LAN);
    expect((await resolve()).serverUrl).toBe(OLD_LAN);
  });

  it('a later installer with a different address wins again', async () => {
    bake(OLD_LAN);
    await resolve();
    bake(VPS);
    expect((await resolve()).serverUrl).toBe(VPS);
  });

  it('an installer with nothing baked leaves config.json alone', async () => {
    writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ serverUrl: OLD_LAN }));
    expect((await resolve()).serverUrl).toBe(OLD_LAN);
    expect(existsSync(path.join(userData, 'installer-server.json'))).toBe(false);
  });
});
