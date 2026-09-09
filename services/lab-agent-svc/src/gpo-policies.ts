import { execFileSync } from 'node:child_process';

/**
 * Ctrl+Alt+Del input-lock mitigation (design doc §3.2, tracked since Phase
 * 1 as an accepted gap in docs/compliance-matrix.md: "Ctrl+Alt+Del cannot
 * be blocked — WEKF unavailable on Windows 11 Pro"). The Secure Attention
 * Sequence itself cannot be intercepted by any user-mode process by
 * design — that is what makes it "secure" — so the only real mitigation
 * is removing every option Windows offers *after* Ctrl+Alt+Del is
 * pressed, via the four policy values below. All four together leave
 * "Cancel" as the only working choice on that screen — no Task Manager,
 * no lock, no sign-out, no password change.
 *
 * These are ordinary Local Group Policy registry values, written directly
 * under HKLM rather than through gpedit/a domain GPO — there is no domain
 * controller in this air-gapped deployment (design doc §2.8), and the
 * Windows policy engine honours the machine-wide HKLM path for all four
 * of these keys, not just the per-user HKCU one a domain GPO would
 * normally populate.
 *
 * Kept as plain, individually-testable data (not shelled-out strings) so
 * `gpo-policies.test.ts` can assert on the actual values without ever
 * invoking reg.exe — see applyGpoPolicies() for the one function that
 * does, and install.ts's doc comment on why this pass doesn't call it
 * against this dev machine.
 */
export interface RegValue {
  /** Human label for logs/tests — not passed to reg.exe. */
  description: string;
  hive: 'HKLM' | 'HKCU';
  path: string;
  valueName: string;
  type: 'REG_DWORD';
  data: number;
}

export const INPUT_LOCK_GPO_VALUES: RegValue[] = [
  {
    description: 'Disable Task Manager from the Ctrl+Alt+Del screen',
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
    valueName: 'DisableTaskMgr',
    type: 'REG_DWORD',
    data: 1,
  },
  {
    description: 'Disable "Lock this computer" from the Ctrl+Alt+Del screen',
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
    valueName: 'DisableLockWorkstation',
    type: 'REG_DWORD',
    data: 1,
  },
  {
    description: 'Disable "Change a password" from the Ctrl+Alt+Del screen',
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
    valueName: 'DisableChangePassword',
    type: 'REG_DWORD',
    data: 1,
  },
  {
    description: 'Disable "Sign out" from the Start menu / Ctrl+Alt+Del screen',
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
    valueName: 'NoLogoff',
    type: 'REG_DWORD',
    data: 1,
  },
];

/** Pure — builds the exact `reg add` argv for one value, no execution. */
export function toRegAddArgs(value: RegValue): string[] {
  return ['add', `${value.hive}\\${value.path}`, '/v', value.valueName, '/t', value.type, '/d', String(value.data), '/f'];
}

/**
 * Applies every INPUT_LOCK_GPO_VALUES entry via `reg.exe add`. Requires
 * an elevated (Administrator) process — every value here targets HKLM.
 * Not called by anything in this pass's verification (see install.ts):
 * running it would mutate this dev machine's real registry, which is
 * squarely outside what a build/verification pass should ever do to the
 * machine it runs on. Real deployment invokes this from installer.nsh's
 * elevated post-install step, which is a genuinely different machine
 * (the lab server/station image) with a genuinely different blast radius.
 */
export function applyGpoPolicies(): void {
  for (const value of INPUT_LOCK_GPO_VALUES) {
    execFileSync('reg.exe', toRegAddArgs(value), { stdio: 'inherit' });
  }
}
