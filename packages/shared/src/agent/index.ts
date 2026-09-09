/**
 * The elevated station-agent IPC contract (design doc "Native Windows
 * agent" — Phase 5). `services/lab-agent-svc` (LocalSystem) is the server;
 * `apps/desktop`'s main process (normal integrity) is the client. Kept
 * here, not duplicated in both packages, for the same reason the
 * Socket.IO contract lives in `../events` — one place that can't drift.
 *
 * **Verified finding (Phase 5, replacing the original design doc's
 * `GetNamedPipeClientProcessId` sketch):** Node's `net` module gives no
 * access to a named pipe connection's raw Win32 HANDLE — `socket._handle.fd`
 * is `-1` for pipes (confirmed live: `GetNamedPipeClientProcessId` on that
 * value fails with `ERROR_INVALID_HANDLE`), and no other property on the
 * internal `Pipe` handle exposes one either. Implementing true
 * client-process-identity auth would need a real native addon (blocked —
 * no C++ toolchain, same gap as the input-lock hooks) or a full Win32
 * named-pipe reimplementation over FFI with overlapped I/O — a much larger
 * undertaking than this pass's budget justified for an auth layer, when a
 * capability token already closes the actual exploitable gap (a random
 * process cannot guess it) even though it doesn't bind to a specific
 * process image the way the original design doc sketch would have.
 * `token-store.ts`'s own doc comment carries the rest of this trade-off.
 */
export const AGENT_PIPE_NAME = '\\\\.\\pipe\\labportal-agent';

/** Where the rotating capability token and the admin-editable launch
 * allowlist live — %ProgramData% so every local user account (the
 * station's interactive session) can read them, but only
 * SYSTEM/Administrators can write them (see token-store.ts's ACL call). */
export const AGENT_DATA_DIR = 'C:\\ProgramData\\LabPortal';
export const AGENT_TOKEN_FILE = `${AGENT_DATA_DIR}\\agent.token`;
export const AGENT_ALLOWLIST_FILE = `${AGENT_DATA_DIR}\\allowlist.json`;

/** electron-updater's own convention for where it stages a downloaded
 * installer before `quitAndInstall()` would normally run it — the
 * `apply-update` verb only ever runs a file from inside this directory,
 * never an arbitrary path handed to it over the pipe. */
export function updateStagingDir(appName: string): string {
  return `${process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local'}\\${appName}-updater\\pending`;
}

export const AGENT_VERBS = ['shutdown', 'restart', 'resolve-launch', 'apply-update'] as const;
export type AgentVerb = (typeof AGENT_VERBS)[number];

export interface AgentRequest {
  token: string;
  verb: AgentVerb;
  /** `resolve-launch`: `{ programId: string }`. `apply-update`:
   * `{ installerPath: string }`. `shutdown`/`restart`: unused. */
  args?: Record<string, unknown>;
}

export interface AgentResponse {
  ok: boolean;
  error?: string;
  /** `resolve-launch`'s success shape: `{ path: string; args: string[] }` —
   * the agent is the allowlist AUTHORITY, not the process that spawns the
   * program (spawning a GUI app from a Session-0 LocalSystem service
   * cannot show it in the student's interactive session without
   * `CreateProcessAsUser`, a much larger native undertaking this pass
   * didn't need: the caller already runs in the right session, it just
   * needed a tamper-resistant answer to "is this programId allowed, and
   * what does it resolve to"). */
  result?: unknown;
}

/** One JSON object per line, newline-delimited — simplest framing that
 * needs no length-prefix parsing on either end of a `net.Socket`. */
export function encodeAgentMessage(msg: AgentRequest | AgentResponse): Buffer {
  return Buffer.from(`${JSON.stringify(msg)}\n`, 'utf8');
}
