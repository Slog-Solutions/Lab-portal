#!/usr/bin/env node
// Runs LiveKit + the server/web dev stack together, prefixing each child's
// output and tearing every child down when any one exits or on Ctrl-C.
//
// Deliberately dependency-free (no concurrently/npm-run-all): this monorepo
// has a documented footgun where adding almost any new npm dependency can
// break every tsup build (`Cannot find module 'esbuild'`) via npm workspace
// hoisting — see docs/compliance-matrix.md and the project's own notes on
// the esbuild/npm-dedupe issue. node:child_process is enough for this.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// On Windows, `npm` resolves to `npm.cmd`, a batch file — CreateProcess
// can't exec that directly (spawn EINVAL) unless the shell interprets it,
// so `shell: true` is required there. Node handles argv quoting for us in
// both the cmd.exe (win32) and /bin/sh (POSIX) cases when shell is true.
const useShell = process.platform === 'win32';

const specs = [
  { name: 'livekit', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev:livekit'] },
  { name: 'web', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:web'] },
];

const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const reset = '\x1b[0m';
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    process.stdout.write(`${color}[${name}]${reset} ${line}\n`);
  }
}

function shutdownAll(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child, name } of children) {
    if (!child.killed) {
      console.log(`[dev-all] stopping ${name}…`);
      child.kill(signal ?? 'SIGTERM');
    }
  }
}

for (const spec of specs) {
  // With shell:true, pass one joined command string rather than a
  // separate args array — args here are fixed/trusted (never user input),
  // and joining avoids Node's DEP0190 warning about unescaped argv.
  const child = useShell
    ? spawn([spec.cmd, ...spec.args].join(' '), { cwd: root, shell: true })
    : spawn(spec.cmd, spec.args, { cwd: root });
  children.push({ ...spec, child });

  child.stdout.on('data', (chunk) => prefix(spec.name, spec.color, chunk));
  child.stderr.on('data', (chunk) => prefix(spec.name, spec.color, chunk));

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev-all] "${spec.name}" exited (${signal ?? code}) — stopping the rest.`);
    shutdownAll();
    process.exitCode = code ?? 1;
  });

  child.on('error', (err) => {
    console.error(`[dev-all] failed to start "${spec.name}": ${err.message}`);
    shutdownAll();
    process.exitCode = 1;
  });
}

process.on('SIGINT', () => {
  shutdownAll('SIGINT');
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});
process.on('SIGTERM', () => {
  shutdownAll('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});
