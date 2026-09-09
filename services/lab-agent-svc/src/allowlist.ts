import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AGENT_ALLOWLIST_FILE, AGENT_DATA_DIR } from '@lab/shared/agent';

export interface AllowlistEntry {
  path: string;
  args?: string[];
}

/**
 * The `resolve-launch` verb's authority (design doc "closed verb set" —
 * `LAUNCH_PROGRAM` should never accept an arbitrary path off the wire).
 * Living in `%ProgramData%\LabPortal\allowlist.json` (SYSTEM/Administrators
 * write, everyone read — same ACL posture as the token file) rather than
 * hardcoded in `apps/desktop`'s own bundle means an admin can add a
 * program without rebuilding/redeploying the Electron app, and — the part
 * that actually matters for trust — a compromised student-side process
 * cannot edit its own allowlist to add something malicious, because it
 * has no write access to this path.
 */
const DEFAULT_ALLOWLIST: Record<string, AllowlistEntry> = {
  notepad: { path: 'notepad.exe' },
  calculator: { path: 'calc.exe' },
};

export function ensureAllowlistFile(): void {
  if (existsSync(AGENT_ALLOWLIST_FILE)) return;
  mkdirSync(AGENT_DATA_DIR, { recursive: true });
  writeFileSync(AGENT_ALLOWLIST_FILE, JSON.stringify(DEFAULT_ALLOWLIST, null, 2), 'utf8');
}

export function resolveLaunch(programId: string): AllowlistEntry | null {
  try {
    const raw = readFileSync(AGENT_ALLOWLIST_FILE, 'utf8');
    const allowlist = JSON.parse(raw) as Record<string, AllowlistEntry>;
    return allowlist[programId] ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lab-agent-svc] failed to read allowlist.json — treating as empty', err);
    return null;
  }
}
