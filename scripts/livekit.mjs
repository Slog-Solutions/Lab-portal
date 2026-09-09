#!/usr/bin/env node
// Launches the vendored native LiveKit server (infra/livekit/bin/livekit-server.exe)
// against infra/livekit/livekit.yaml. Deliberately dependency-free — see
// scripts/dev-all.mjs's header comment for why (esbuild/tsup hoisting footgun).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const exe = resolve(root, 'infra/livekit/bin/livekit-server.exe');
const cfg = resolve(root, 'infra/livekit/livekit.yaml');

if (!existsSync(exe)) {
  console.error(
    `[livekit] Could not find the vendored LiveKit binary at:\n` +
      `  ${exe}\n\n` +
      `See infra/README.md for how to obtain/place it (or use the Docker path:\n` +
      `  docker compose -f infra/docker-compose.yml up -d livekit).`,
  );
  process.exit(1);
}
if (!existsSync(cfg)) {
  console.error(`[livekit] Missing config file: ${cfg}`);
  process.exit(1);
}

console.log(`[livekit] starting ${exe}`);
console.log(`[livekit] config: ${cfg}`);

const child = spawn(exe, ['--config', cfg], { stdio: 'inherit' });

let shuttingDown = false;
function forward(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill(signal);
}
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on('error', (err) => {
  console.error(`[livekit] failed to start: ${err.message}`);
  process.exit(1);
});
