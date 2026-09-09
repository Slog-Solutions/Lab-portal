import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Imports the lab's internal root CA (infra/caddy — the TLS termination
 * in front of the Nest API/web dist, design doc §2.8) into the machine's
 * Trusted Root store, so the station's browser/Electron shell trusts
 * `https://labserver.lab.local` without a per-seat manual "proceed
 * anyway" click, which would otherwise train 40 students to click through
 * TLS warnings — exactly the habit an air-gapped deployment can least
 * afford to teach.
 */
export function importRootCa(certPath: string): void {
  if (!existsSync(certPath)) {
    throw new Error(`Root CA certificate not found at ${certPath} — export it from infra/caddy before packaging the installer`);
  }
  execFileSync('certutil.exe', ['-addstore', '-f', 'Root', certPath], { stdio: 'inherit' });
}
