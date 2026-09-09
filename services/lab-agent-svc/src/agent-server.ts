import { execFile, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AGENT_PIPE_NAME, type AgentRequest, type AgentResponse, updateStagingDir } from '@lab/shared/agent';
import { verifyToken } from './token-store.js';
import { resolveLaunch } from './allowlist.js';

/**
 * The elevated agent's IPC surface (design doc "Native Windows agent").
 * A closed verb set, not a command shell: every branch below is a fixed,
 * narrow action, the same posture `apps/desktop/src/main/command-handler.ts`
 * already documents for its own OPEN_URL/LAUNCH_PROGRAM handling — there
 * is no "run arbitrary command" verb, by construction. This is the piece
 * the design doc calls "the single most important security control in the
 * system": shutdown/restart/launch/update all being mediated here, not
 * trusted to the (normal-integrity, network-facing) Electron process
 * alone, means a compromised student-side app still can't do anything
 * this list doesn't allow.
 */
export function startAgentServer(appName: string): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      // eslint-disable-next-line no-cond-assign
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) handleLine(socket, line, appName);
      }
    });
    socket.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[lab-agent-svc] pipe connection error', err);
    });
  });

  server.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[lab-agent-svc] pipe server error on ${AGENT_PIPE_NAME}`, err);
  });
  server.listen(AGENT_PIPE_NAME, () => {
    // eslint-disable-next-line no-console
    console.log(`[lab-agent-svc] listening on ${AGENT_PIPE_NAME}`);
  });
  return server;
}

function handleLine(socket: net.Socket, line: string, appName: string): void {
  let request: AgentRequest;
  try {
    request = JSON.parse(line) as AgentRequest;
  } catch {
    reply(socket, { ok: false, error: 'Malformed request (not JSON)' });
    return;
  }

  if (!verifyToken(request.token)) {
    reply(socket, { ok: false, error: 'Invalid or stale capability token' });
    return;
  }

  switch (request.verb) {
    case 'shutdown':
      execFile('shutdown.exe', ['/s', '/t', '5', '/c', 'Shutdown requested by instructor'], (err) =>
        reply(socket, err ? { ok: false, error: err.message } : { ok: true }),
      );
      return;

    case 'restart':
      execFile('shutdown.exe', ['/r', '/t', '5', '/c', 'Restart requested by instructor'], (err) =>
        reply(socket, err ? { ok: false, error: err.message } : { ok: true }),
      );
      return;

    case 'resolve-launch': {
      const programId = String(request.args?.programId ?? '');
      const entry = resolveLaunch(programId);
      if (!entry) {
        reply(socket, { ok: false, error: `programId "${programId}" is not in the allowlist` });
        return;
      }
      // The agent resolves; it does NOT spawn. Spawning a GUI program from
      // this LocalSystem/Session-0 service would need CreateProcessAsUser
      // to ever be visible in the student's interactive session — see
      // @lab/shared/agent's doc comment on why the caller (already running
      // in the right session) does the actual exec() with this answer.
      reply(socket, { ok: true, result: entry });
      return;
    }

    case 'apply-update': {
      const installerPath = String(request.args?.installerPath ?? '');
      const stagingDir = updateStagingDir(appName);
      const resolved = path.resolve(installerPath);
      if (!resolved.startsWith(path.resolve(stagingDir) + path.sep)) {
        reply(socket, { ok: false, error: `installerPath must be inside ${stagingDir}` });
        return;
      }
      if (!existsSync(resolved)) {
        reply(socket, { ok: false, error: `${resolved} does not exist` });
        return;
      }
      // Silent, elevated install — this IS the "no runtime UAC prompt"
      // value the design doc calls for: the service is already elevated,
      // so a perMachine NSIS installer that would otherwise interrupt a
      // student with a UAC dialog runs invisibly instead. The installer
      // itself (electron-builder NSIS default) relaunches the app.
      execFile(resolved, ['/S'], (err) => reply(socket, err ? { ok: false, error: err.message } : { ok: true }));
      return;
    }

    default:
      reply(socket, { ok: false, error: `Unknown verb: ${(request as AgentRequest).verb}` });
  }
}

function reply(socket: net.Socket, response: AgentResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

/** Exposed for install.ts's smoke check — confirms shutdown.exe itself
 * resolves on PATH without actually invoking it (execFile above already
 * proves the real path once the service runs for real). */
export function agentBinaryPathsExist(): boolean {
  try {
    execFileSync('where.exe', ['shutdown.exe'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
