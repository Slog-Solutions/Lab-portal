import { exec } from 'node:child_process';
import { Notification, shell } from 'electron';
import { CommandType, type CommandEnvelope } from '@lab/shared';

/**
 * Local, client-side allowlist for LAUNCH_PROGRAM (design doc §3.5:
 * "server-side allowlist of launchable programs — path and args
 * validated. Never accept an arbitrary command string off the wire").
 * The server's own allowlist check happens in Phase 1's admin config;
 * this is the second, client-side gate — a compromised or buggy server
 * still cannot make a station spawn an arbitrary binary, because the
 * client only ever resolves a known `programId` key to a fixed local
 * path, never the wire payload's own path/args as a command line.
 */
const PROGRAM_ALLOWLIST: Record<string, string> = {
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
};

export interface CommandResult {
  status: 'applied' | 'failed' | 'ignored';
  error?: string;
}

/**
 * Executes one imperative command (design doc §4.3). Every branch here
 * is deliberately narrow — no branch accepts an arbitrary string off the
 * wire and executes it. Shutdown/restart need no elevation
 * (SeShutdownPrivilege is held by Users on workstations); everything
 * else runs at normal integrity in this process.
 */
export async function executeCommand(envelope: CommandEnvelope): Promise<CommandResult> {
  try {
    switch (envelope.type) {
      case CommandType.SHUTDOWN: {
        exec('shutdown /s /t 5 /c "Shutdown requested by instructor"');
        return { status: 'applied' };
      }
      case CommandType.RESTART: {
        exec('shutdown /r /t 5 /c "Restart requested by instructor"');
        return { status: 'applied' };
      }
      case CommandType.WAKE: {
        // Wake-on-LAN targets offline machines by definition — a station
        // that is online and receiving this command is a no-op.
        return { status: 'ignored' };
      }
      case CommandType.LAUNCH_PROGRAM: {
        const payload = envelope.payload as { programId: string; args?: string[] };
        const resolvedPath = PROGRAM_ALLOWLIST[payload.programId];
        if (!resolvedPath) {
          return { status: 'failed', error: `programId "${payload.programId}" is not in the local allowlist` };
        }
        exec(`"${resolvedPath}"`);
        return { status: 'applied' };
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
      case CommandType.PUSH_FILE: {
        // Media download + placement lands with the CMS in Phase 3.
        return { status: 'ignored', error: 'PUSH_FILE not yet implemented (Phase 3)' };
      }
      case CommandType.APPLY_UPDATE: {
        // electron-updater integration lands in Phase 5.
        return { status: 'ignored', error: 'APPLY_UPDATE not yet implemented (Phase 5)' };
      }
      default:
        return { status: 'ignored', error: `Unknown command type: ${envelope.type}` };
    }
  } catch (err) {
    return { status: 'failed', error: (err as Error).message };
  }
}
