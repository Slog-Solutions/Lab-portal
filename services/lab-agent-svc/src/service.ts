import { fileURLToPath } from 'node:url';
import { Service } from 'node-windows';
// node-windows spawns this as a plain `node <script>` process, so it must
// be the built CJS output (see package.json's build script), not the .ts
// source — resolved relative to this file so it works from dist/ too.

/**
 * `node-windows` was picked over a native Windows service framework for
 * the same reason `@nut-tree-fork/nut-js` was picked over the blocked
 * native input-lock hook (Phase 1 close-out): it needs no C++ toolchain
 * (`cl.exe`/CMake/VS Build Tools are absent on this build machine — see
 * that same close-out note) — it's pure JS that shells out to Windows'
 * own `sc.exe`, wrapped for lifecycle management via a small generated
 * WinSW-style stub. Real, not a stub, once actually installed elevated.
 */
const SERVICE_NAME = 'LabAgentSvc';

export function buildService(): Service {
  return new Service({
    name: SERVICE_NAME,
    description: 'Digital Language Lab — elevated station agent (input-lock GPO enforcement).',
    script: fileURLToPath(new URL('../dist/daemon-entry.cjs', import.meta.url)),
  });
}
