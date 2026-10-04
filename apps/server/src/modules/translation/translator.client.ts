import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TranslationEngineHealth, TranslationEngineParams } from '@lab/shared';
import type { EnvConfig } from '../../config/env.validation';

/** One (class, language) stream as the translator reports it. */
export interface TranslatorStreamStat {
  lang: string;
  state: 'starting' | 'live' | 'degraded' | 'error';
  lagMs: number | null;
  error?: string;
}

export interface TranslatorSessionStat {
  sessionId: string;
  room: string;
  connected: boolean;
  streams: TranslatorStreamStat[];
}

export interface UpsertSessionRequest {
  /** Our id for this session — the LiveClass id. Idempotency key. */
  sessionId: string;
  room: string;
  /** Where the translator should connect; may differ from the server's own
   * LiveKit URL (see TRANSLATOR_LIVEKIT_URL). */
  livekitUrl: string;
  /** A token minted by MediaService.mintServiceToken for `room`. */
  token: string;
  /** Identity prefix of the participant whose mic is the SOURCE. The
   * translator re-resolves the track on every republish/reconnect rather
   * than being handed a track sid, which would go stale the moment the
   * teacher toggles their mic. */
  sourceIdentityPrefix: string;
  sourceLanguage: string;
  targetLanguages: string[];
  engineParams: TranslationEngineParams;
}

export interface TestRunRequest {
  runId: string;
  /** Absolute path, inside the translator container, of the uploaded
   * audio. Only valid because server and translator share the LabData
   * volume — a translator on a separate host uses `audioUrl` instead. */
  audioPath?: string;
  audioUrl?: string;
  sourceLanguage: string;
  targetLanguages: string[];
  mode: 'realtime' | 'fast';
  engineParams: TranslationEngineParams;
  /** Set for `realtime`: the translator creates this room, publishes the
   * original as `src` paced at 1x, and publishes translations into it. */
  room?: string;
  livekitUrl?: string;
  token?: string;
  /** Where to write <lang>.wav + transcripts, inside the translator. */
  outputDir: string;
}

/**
 * Thin HTTP client for services/translator. Deliberately holds no state
 * about what SHOULD be running — TranslationService owns that and this
 * class only speaks the wire protocol, so a translator restart is
 * recovered by the reconciler's next sweep rather than by bookkeeping
 * here.
 *
 * Every call is best-effort from the caller's point of view: `configured`
 * is false when TRANSLATOR_URL is unset, and a network failure surfaces
 * as a thrown error the reconciler logs and retries. Nothing in here may
 * ever break a live class — translation is an enhancement on top of audio
 * that already works.
 */
@Injectable()
export class TranslatorClient {
  private readonly logger = new Logger(TranslatorClient.name);
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  readonly livekitUrl: string;

  constructor(config: ConfigService<EnvConfig, true>) {
    const url = config.get('TRANSLATOR_URL', { infer: true });
    this.baseUrl = url ? url.replace(/\/+$/, '') : null;
    this.apiKey = config.get('TRANSLATOR_API_KEY', { infer: true }) ?? null;
    this.timeoutMs = config.get('TRANSLATOR_TIMEOUT_MS', { infer: true });
    this.livekitUrl = config.get('TRANSLATOR_LIVEKIT_URL', { infer: true }) ?? config.get('LIVEKIT_URL', { infer: true });
    if (!this.baseUrl) {
      this.logger.log('TRANSLATOR_URL is unset — live class translation is disabled.');
    }
  }

  /** Whether the feature is configured at all. Every surface checks this
   * before offering translation, so an unconfigured server hides it
   * rather than failing calls. */
  get configured(): boolean {
    return this.baseUrl !== null;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.baseUrl) throw new ServiceUnavailableException('Translation is not configured on this server');
    // AbortSignal.timeout rather than a manual setTimeout+clear: a hung
    // translator must not pin the reconciler's interval forever, and
    // every call here is on a path that a live class is waiting behind.
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`translator ${method} ${path} -> ${res.status} ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /** Never throws — health is polled on a timer and shown in the UI, so a
   * dead translator must render as "unreachable", not crash the poll. */
  async health(): Promise<TranslationEngineHealth> {
    if (!this.baseUrl) return { reachable: false, gpu: false, detail: 'TRANSLATOR_URL is not set' };
    try {
      const h = await this.call<Omit<TranslationEngineHealth, 'reachable'>>('GET', '/health');
      return { ...h, reachable: true };
    } catch (err) {
      return { reachable: false, gpu: false, detail: (err as Error).message };
    }
  }

  /** Idempotent: creates the session or updates its target languages in
   * place. The translator adds/removes language streams without
   * reconnecting to LiveKit, so a student switching language mid-class
   * does not interrupt anyone else's audio. */
  async upsertSession(req: UpsertSessionRequest): Promise<TranslatorSessionStat> {
    return this.call<TranslatorSessionStat>('PUT', `/v1/sessions/${encodeURIComponent(req.sessionId)}`, req);
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.call<unknown>('DELETE', `/v1/sessions/${encodeURIComponent(sessionId)}`);
    } catch (err) {
      // A session that is already gone (translator restarted) is the
      // desired end state, so this is logged, not propagated — class
      // teardown must not fail because the translator is down.
      this.logger.warn(`deleteSession(${sessionId}) failed: ${(err as Error).message}`);
    }
  }

  async sessions(): Promise<TranslatorSessionStat[]> {
    const res = await this.call<{ sessions: TranslatorSessionStat[] }>('GET', '/v1/sessions');
    return res.sessions;
  }

  async startTestRun(req: TestRunRequest): Promise<{ runId: string; status: string }> {
    return this.call<{ runId: string; status: string }>('POST', '/v1/test-runs', req);
  }

  async testRun(runId: string): Promise<{
    runId: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    error?: string;
    durationMs?: number;
    metrics?: unknown;
  }> {
    return this.call('GET', `/v1/test-runs/${encodeURIComponent(runId)}`);
  }

  async cancelTestRun(runId: string): Promise<void> {
    try {
      await this.call<unknown>('DELETE', `/v1/test-runs/${encodeURIComponent(runId)}`);
    } catch (err) {
      this.logger.warn(`cancelTestRun(${runId}) failed: ${(err as Error).message}`);
    }
  }
}
