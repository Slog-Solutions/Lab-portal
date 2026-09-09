import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { AGENT_PIPE_NAME, AGENT_TOKEN_FILE, type AgentRequest, type AgentResponse, type AgentVerb } from '@lab/shared/agent';

/**
 * The normal-integrity side of the elevated agent's closed verb set (see
 * `services/lab-agent-svc/src/agent-server.ts`'s doc comment). Every
 * caller in `command-handler.ts` tries this FIRST and falls back to the
 * pre-Phase-5 direct `exec()` path if it fails — a dev machine (or any
 * station imaged without `lab-agent-svc install:elevated` having been
 * run) keeps working exactly as before, honestly degraded rather than
 * broken, the same posture native-bridge and the pronunciation pipeline
 * already established for their own missing-dependency cases.
 */
export async function sendToAgent(verb: AgentVerb, args?: Record<string, unknown>, timeoutMs = 5_000): Promise<AgentResponse> {
  const token = await readFile(AGENT_TOKEN_FILE, 'utf8').catch(() => {
    throw new Error('lab-agent-svc is not installed on this station (no agent.token file)');
  });

  return new Promise((resolve, reject) => {
    const socket = net.connect(AGENT_PIPE_NAME);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out waiting for lab-agent-svc after ${timeoutMs}ms`));
    }, timeoutMs);

    let buffer = '';
    socket.on('connect', () => {
      const request: AgentRequest = { token: token.trim(), verb, args };
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.slice(0, newlineIndex)) as AgentResponse);
      } catch (err) {
        reject(err as Error);
      }
      socket.end();
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
