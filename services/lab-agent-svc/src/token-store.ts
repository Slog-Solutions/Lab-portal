import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AGENT_DATA_DIR, AGENT_TOKEN_FILE } from '@lab/shared/agent';

/**
 * The capability token every `AgentRequest` must present (see
 * `@lab/shared/agent`'s own doc comment for why this is what ships
 * instead of the design doc's original client-process-identity sketch).
 * Rotated once per service start — not per request, and not on a timer —
 * which is enough to make the token useless to anything that isn't
 * running on this machine after the service last (re)started, while
 * staying simple enough to reason about.
 *
 * Written to `%ProgramData%\LabPortal\agent.token` with an ACL that grants
 * read to the local `Users` group (every station's interactive session
 * needs to read it) but write only to SYSTEM/Administrators — `icacls`
 * is a standard, scriptable Windows tool, not a native dependency.
 */
let currentToken: string | null = null;

export function rotateToken(): string {
  currentToken = randomBytes(32).toString('hex');
  mkdirSync(AGENT_DATA_DIR, { recursive: true });
  writeFileSync(AGENT_TOKEN_FILE, currentToken, { encoding: 'utf8' });
  try {
    // /inheritance:r drops inherited (often broad, e.g. Everyone:F on some
    // ProgramData ACL templates) permissions before granting exactly the
    // two we want — a token file with an inherited Everyone:F ACL would
    // defeat the whole point of writing one.
    execFileSync('icacls.exe', [
      AGENT_TOKEN_FILE,
      '/inheritance:r',
      '/grant:r',
      'SYSTEM:F',
      '/grant:r',
      'Administrators:F',
      '/grant:r',
      'Users:R',
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lab-agent-svc] failed to set agent.token ACL — the token file may be over-permissive', err);
  }
  return currentToken;
}

export function verifyToken(candidate: string): boolean {
  return currentToken !== null && candidate === currentToken;
}
