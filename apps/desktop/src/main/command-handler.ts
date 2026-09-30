import { exec, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { app, Notification, shell } from 'electron';
import { CommandType, type CommandEnvelope, type PushFilePayload } from '@lab/shared';
import { sendToAgent } from './agent-client';
import { applyDownloadedUpdate } from './updater';

const execAsync = promisify(exec);

/**
 * Fires `shutdown.exe` and actually waits on it, unlike a bare
 * fire-and-forget `exec()` — otherwise a failure silently no-ops while
 * this still reports `applied` to the teacher. `/f` forces every app to
 * close instead of leaving the OS blocked on a "these programs need to
 * close" prompt nobody is at the console to dismiss — the biggest reason
 * this looked "broken" on a real desktop with several apps open versus a
 * bare kiosk seat, where the missing flag never showed up because there
 * was nothing to block on.
 *
 * Windows error 1190 ("a system shutdown is already in progress") is a
 * NORMAL state on a real workstation, not an exotic one — Windows Update
 * can leave a reboot pending, or a manually-initiated shutdown can get
 * blocked and never formally cancelled (no matching 1075 event). Once
 * that happens, every subsequent `shutdown.exe` call fails immediately,
 * before `/t`/`/f` are ever considered — this was caught live on this
 * exact machine (System event log: a clean 1074 at 12:00, a blocked
 * Start-menu shutdown at 12:06 with no 1075 cancel, then four
 * instructor-issued commands in a row producing no 1074 at all). Since
 * an instructor's explicit command is the higher authority on a
 * classroom seat, pre-abort any stale pending shutdown before issuing
 * the real one — this also cancels a legitimate admin-scheduled
 * Windows-Update reboot, which is the accepted trade-off here.
 * `shutdown /a` itself exits non-zero (error 1116, "no shutdown was in
 * progress") in the common case where nothing was pending — that failure
 * is expected and swallowed.
 */
async function runShutdownCommand(mode: '/s' | '/r', message: string): Promise<void> {
  try {
    await execAsync('shutdown /a');
  } catch {
    // Nothing was pending (error 1116) — the normal case. Proceed either way.
  }

  try {
    await execAsync(`shutdown ${mode} /t 5 /f /c "${message}"`);
  } catch (err) {
    // shutdown.exe writes its diagnostic (including the Win32 error code,
    // e.g. "(1190)") to stdout, not just the exit-code line in err.message
    // — fold both streams in so the real OS-level reason actually reaches
    // the teacher's audit log instead of a bare "Command failed".
    const e = err as Error & { stdout?: string; stderr?: string };
    const detail = [e.stdout, e.stderr].filter(Boolean).join(' ').trim();
    throw new Error(detail || e.message);
  }
}

/**
 * Local, client-side allowlist for LAUNCH_PROGRAM — the fallback used
 * only when `lab-agent-svc` isn't reachable (see `sendToAgent`'s doc
 * comment). When the agent IS reachable, its own `%ProgramData%`
 * allowlist (`services/lab-agent-svc/src/allowlist.ts`) is authoritative
 * instead — admin-editable without a rebuild, and not writable by this
 * (normal-integrity, network-facing) process. Either way, the same
 * invariant holds: a `programId` off the wire only ever resolves to a
 * fixed local path, never an arbitrary command line.
 */
const PROGRAM_ALLOWLIST: Record<string, string> = {
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
};

export interface CommandResult {
  status: 'applied' | 'failed' | 'ignored';
  error?: string;
}

export interface CommandHandlerContext {
  serverUrl: string;
  getToken: () => string | null;
}

/**
 * Executes one imperative command (design doc §4.3). Every branch here
 * is deliberately narrow — no branch accepts an arbitrary string off the
 * wire and executes it. Shutdown/restart need no elevation
 * (SeShutdownPrivilege is held by Users on workstations); everything
 * else runs at normal integrity in this process.
 */
export async function executeCommand(envelope: CommandEnvelope, context: CommandHandlerContext): Promise<CommandResult> {
  try {
    switch (envelope.type) {
      case CommandType.SHUTDOWN: {
        // Phase 5: mediated through lab-agent-svc's closed verb set when
        // installed (auditable/centralized there, matching the design
        // doc's "every privileged action" posture) — SeShutdownPrivilege
        // is held by Users on workstations either way, so the direct
        // fallback is a correctness equivalent, not a weaker no-op.
        // sendToAgent only REJECTS on a missing agent (no token file,
        // pipe error, timeout) — a reachable agent that fails its own
        // shutdown.exe call (stale token, error 1190, ...) RESOLVES with
        // {ok:false}, same as LAUNCH_PROGRAM's res.ok check below. That
        // resolved failure must still fall through to the local retry,
        // or the teacher sees "applied" while the agent silently no-op'd.
        let viaAgent = false;
        try {
          const res = await sendToAgent('shutdown');
          viaAgent = res.ok;
        } catch {
          // No agent installed on this station — normal on a dev box or
          // an un-imaged seat. Fall through to the local command below.
        }
        if (!viaAgent) await runShutdownCommand('/s', 'Shutdown requested by instructor');
        return { status: 'applied' };
      }
      case CommandType.RESTART: {
        let viaAgent = false;
        try {
          const res = await sendToAgent('restart');
          viaAgent = res.ok;
        } catch {
          // No agent installed — fall through to the local command below.
        }
        if (!viaAgent) await runShutdownCommand('/r', 'Restart requested by instructor');
        return { status: 'applied' };
      }
      case CommandType.WAKE: {
        // Wake-on-LAN targets offline machines by definition — a station
        // that is online and receiving this command is a no-op.
        return { status: 'ignored' };
      }
      case CommandType.LAUNCH_PROGRAM: {
        const payload = envelope.payload as { programId: string; args?: string[] };
        // The agent RESOLVES (its own admin-editable allowlist authority
        // — see agent-client.ts's doc comment); this process still does
        // the actual exec(), since a LocalSystem/Session-0 service cannot
        // make a GUI program appear in the student's interactive session
        // without a much larger CreateProcessAsUser undertaking.
        try {
          const res = await sendToAgent('resolve-launch', { programId: payload.programId });
          if (!res.ok) return { status: 'failed', error: res.error };
          const entry = res.result as { path: string; args?: string[] };
          execFile(entry.path, entry.args ?? []);
          return { status: 'applied' };
        } catch {
          const resolvedPath = PROGRAM_ALLOWLIST[payload.programId];
          if (!resolvedPath) {
            return { status: 'failed', error: `programId "${payload.programId}" is not in the local allowlist` };
          }
          exec(`"${resolvedPath}"`);
          return { status: 'applied' };
        }
      }
      case CommandType.OPEN_URL: {
        const payload = envelope.payload as { url: string };
        const parsed = new URL(payload.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { status: 'failed', error: `Blocked non-http(s) URL scheme: ${parsed.protocol}` };
        }
        await shell.openExternal(payload.url);
        return { status: 'applied' };
      }
      case CommandType.MESSAGE: {
        const payload = envelope.payload as { text: string; severity: 'info' | 'warning' };
        if (Notification.isSupported()) {
          new Notification({ title: payload.severity === 'warning' ? 'Warning' : 'Message', body: payload.text }).show();
        }
        return { status: 'applied' };
      }
      case CommandType.OPEN_ASSIGNMENT: {
        // Handled by the student console in the renderer (it opens the
        // assignment); nothing for the main process to do.
        return { status: 'applied' };
      }
      case CommandType.PUSH_FILE: {
        const payload = envelope.payload as PushFilePayload;
        const token = context.getToken();
        if (!token) {
          return { status: 'failed', error: 'No station credential yet — cannot authenticate the download' };
        }

        const meta = await fetch(`${context.serverUrl}/api/media-assets/${payload.assetId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meta.ok) {
          return { status: 'failed', error: `Could not fetch asset metadata (${meta.status})` };
        }
        const asset = (await meta.json()) as { filename: string };

        const fileRes = await fetch(`${context.serverUrl}/api/media-assets/${payload.assetId}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!fileRes.ok || !fileRes.body) {
          return { status: 'failed', error: `Could not download asset file (${fileRes.status})` };
        }

        const destDir = app.getPath(payload.destinationHint === 'desktop' ? 'desktop' : 'downloads');
        await mkdir(destDir, { recursive: true });
        const destPath = path.join(destDir, asset.filename);
        // fetch's body is a web ReadableStream; Readable.fromWeb bridges it
        // to Node's stream API so it can pipe into a file write stream.
        await finished(Readable.fromWeb(fileRes.body as never).pipe(createWriteStream(destPath)));
        return { status: 'applied' };
      }
      case CommandType.APPLY_UPDATE: {
        return applyDownloadedUpdate();
      }
      default:
        return { status: 'ignored', error: `Unknown command type: ${envelope.type}` };
    }
  } catch (err) {
    return { status: 'failed', error: (err as Error).message };
  }
}
