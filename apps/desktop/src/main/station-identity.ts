import { randomUUID } from 'node:crypto';
import { networkInterfaces, hostname } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface LabRuntimeConfig {
  platform: 'web' | 'desktop';
  serverUrl: string;
  stationId?: string;
}

export interface StationIdentityCache {
  machineGuid: string;
  stationId: string | null;
  seatNo: number | null;
}

/**
 * Station identity is a stable machine GUID, never hostname/MAC — both
 * drift on rename or NIC replacement (design doc §3.7).
 *
 * Production path: read `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
 * via the elevated LabAgentSvc helper (Phase 1 — services/lab-agent-svc),
 * since a normal-integrity renderer/main process has no reason to touch
 * the registry directly. For local dev today (no service installed yet),
 * we generate and cache a UUID under userData so the registration flow
 * and the server's Station.machineGuid contract can be exercised end to
 * end — this function is the ONLY place that distinction lives, so
 * swapping in the real registry read later touches one function, not
 * every caller.
 */
export async function getOrCreateMachineGuid(userDataDir: string): Promise<string> {
  const cachePath = path.join(userDataDir, 'station.json');
  try {
    const raw = await readFile(cachePath, 'utf-8');
    const cached = JSON.parse(raw) as StationIdentityCache;
    if (cached.machineGuid) return cached.machineGuid;
  } catch {
    // No cache yet — fall through to create one.
  }
  const machineGuid = randomUUID();
  await mkdir(userDataDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify({ machineGuid, stationId: null, seatNo: null }, null, 2));
  return machineGuid;
}

export function getMacAddresses(): string[] {
  const macs = new Set<string>();
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs.add(addr.mac);
      }
    }
  }
  return Array.from(macs);
}

export function getHostname(): string {
  return hostname();
}
