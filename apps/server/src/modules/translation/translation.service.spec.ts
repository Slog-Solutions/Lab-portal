import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { TranslationService } from './translation.service';
import { TranslatorClient } from './translator.client';
import { TranslationStateStore } from '../control/translation-state.store';
import type { TranslationSettingsService } from './translation-settings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MediaService } from '../media/media.service';
import type { ControlGateway } from '../control/control.gateway';
import type { SessionStateService } from '../control/session-state.service';
import { DEFAULT_TRANSLATION_ENGINE_PARAMS } from '@lab/shared';

const API_KEY = 'spec-key';

/**
 * A stand-in translator over real HTTP, so these tests exercise
 * TranslatorClient's actual wire format (headers, method, URL shape,
 * error handling) rather than a hand-stubbed client. The expensive half —
 * the GPU — is what is faked, not the contract.
 */
interface FakeTranslator {
  server: Server;
  url: string;
  upserts: { id: string; langs: string[]; room: string; sourceIdentityPrefix: string }[];
  deletes: string[];
  sessions: Map<string, string[]>;
  failNext: boolean;
  reset(): void;
}

async function startFakeTranslator(): Promise<FakeTranslator> {
  const state = {
    upserts: [] as FakeTranslator['upserts'],
    deletes: [] as string[],
    sessions: new Map<string, string[]>(),
    failNext: false,
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const path = new URL(req.url ?? '/', 'http://x').pathname;

      if (path === '/health') {
        return send(200, { gpu: true, device: 'fake', modelLoaded: true, activeStreams: 0, maxStreams: 4 });
      }
      if (req.headers['x-api-key'] !== API_KEY) return send(401, { detail: 'bad api key' });

      if (path === '/v1/sessions' && req.method === 'GET') {
        return send(200, {
          sessions: [...state.sessions.entries()].map(([id, langs]) => ({
            sessionId: id,
            room: `class:${id}:broadcast`,
            connected: true,
            streams: langs.map((lang) => ({ lang, state: 'live', lagMs: 2400 })),
          })),
        });
      }
      const match = path.match(/^\/v1\/sessions\/(.+)$/);
      if (match) {
        const id = decodeURIComponent(match[1] ?? '');
        if (req.method === 'PUT') {
          if (state.failNext) {
            state.failNext = false;
            return send(503, { detail: 'model not loaded' });
          }
          const payload = JSON.parse(body) as { targetLanguages: string[]; room: string; sourceIdentityPrefix: string };
          state.upserts.push({
            id,
            langs: payload.targetLanguages,
            room: payload.room,
            sourceIdentityPrefix: payload.sourceIdentityPrefix,
          });
          state.sessions.set(id, payload.targetLanguages);
          return send(200, {
            sessionId: id,
            room: payload.room,
            connected: true,
            streams: payload.targetLanguages.map((lang) => ({ lang, state: 'live', lagMs: 2400 })),
          });
        }
        if (req.method === 'DELETE') {
          state.deletes.push(id);
          state.sessions.delete(id);
          return send(200, { ok: true });
        }
      }
      send(404, { detail: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    get upserts() {
      return state.upserts;
    },
    get deletes() {
      return state.deletes;
    },
    get sessions() {
      return state.sessions;
    },
    get failNext() {
      return state.failNext;
    },
    set failNext(v: boolean) {
      state.failNext = v;
    },
    reset() {
      state.upserts.length = 0;
      state.deletes.length = 0;
      state.sessions.clear();
      state.failNext = false;
    },
  };
}

const CLASS_ID = 'class1';

/** The nth upsert the translator received, asserting it happened.
 * A missing one means the reconciler never called out at all, which is a
 * clearer failure than a TypeError deep in an expectation. */
function upsert(fake: FakeTranslator, index: number): FakeTranslator['upserts'][number] {
  const call = fake.upserts[index];
  expect(call, `expected at least ${index + 1} translator upsert(s), got ${fake.upserts.length}`).toBeDefined();
  return call!;
}

/** Seats in the class, as `listenLanguage` values (null = never chose). */
function makeHarness(opts: {
  seatLanguages: (string | null)[];
  translationEnabled?: boolean;
  spokenLanguage?: string;
  enabledLanguages?: string[];
  maxStreams?: number;
  translatorUrl: string;
}) {
  const liveClass = {
    id: CLASS_ID,
    state: 'ACTIVE' as const,
    translationEnabled: opts.translationEnabled ?? true,
    spokenLanguage: opts.spokenLanguage ?? 'eng',
    teacherId: 'teacher1',
  };

  const prisma = {
    liveClass: {
      findUnique: vi.fn().mockResolvedValue(liveClass),
      findFirst: vi.fn().mockResolvedValue(liveClass),
      findMany: vi.fn().mockResolvedValue([liveClass]),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(liveClass, data);
        return Promise.resolve(liveClass);
      }),
    },
    station: {
      findMany: vi.fn().mockResolvedValue(
        opts.seatLanguages.map((lang, i) => ({ id: `st${i}`, currentUser: { listenLanguage: lang } })),
      ),
      findUnique: vi.fn().mockResolvedValue({ currentUserId: 'u1', liveClassId: CLASS_ID }),
    },
    user: { update: vi.fn().mockResolvedValue({}) },
  };

  const settings = {
    get: vi.fn().mockResolvedValue({
      enabledLanguages: opts.enabledLanguages ?? ['eng', 'hin', 'ben', 'tel', 'tam'],
      engineParams: DEFAULT_TRANSLATION_ENGINE_PARAMS,
      maxStreams: opts.maxStreams ?? 4,
    }),
    enabledLanguagesFor: vi.fn().mockResolvedValue(['eng', 'hin', 'ben']),
  };

  const media = {
    ensureRoom: vi.fn().mockResolvedValue(true),
    mintServiceToken: vi.fn().mockResolvedValue('svc-token'),
  };
  const gateway = { pushSnapshot: vi.fn(), emitTranslationStatus: vi.fn() };
  const sessionState = { getDesiredState: vi.fn().mockResolvedValue({ seq: 1 }) };
  const store = new TranslationStateStore();

  const config = new ConfigService({
    TRANSLATOR_URL: opts.translatorUrl,
    TRANSLATOR_API_KEY: API_KEY,
    TRANSLATOR_TIMEOUT_MS: 4000,
    LIVEKIT_URL: 'ws://livekit:7880',
  });

  const svc = new TranslationService(
    prisma as unknown as PrismaService,
    new TranslatorClient(config as unknown as ConfigService<never, true>),
    settings as unknown as TranslationSettingsService,
    media as unknown as MediaService,
    store,
    gateway as unknown as ControlGateway,
    sessionState as unknown as SessionStateService,
  );

  return { svc, prisma, settings, media, gateway, sessionState, store, liveClass };
}

/** markDirty debounces by 300ms; this waits past it plus the HTTP hop. */
async function settle(ms = 700): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('TranslationService — demand computation', () => {
  let fake: FakeTranslator;

  beforeAll(async () => {
    fake = await startFakeTranslator();
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });
  beforeEach(() => fake.reset());

  it('starts one stream per distinct non-spoken language, not one per student', async () => {
    // 40 seats, 3 languages: the GPU cost must track languages, not heads.
    const seatLanguages = [
      ...Array(20).fill('eng'),
      ...Array(10).fill('hin'),
      ...Array(7).fill('ben'),
      ...Array(3).fill('tel'),
    ];
    const { svc } = makeHarness({ seatLanguages, translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();

    expect(fake.upserts).toHaveLength(1);
    expect(upsert(fake, 0).langs.sort()).toEqual(['ben', 'hin', 'tel']);
  });

  it('never translates into the language the teacher is speaking', async () => {
    const { svc } = makeHarness({ seatLanguages: ['eng', 'eng', 'hin'], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(upsert(fake, 0).langs).toEqual(['hin']);
  });

  it('treats a student who never chose a language as listening in the default', async () => {
    const { svc } = makeHarness({ seatLanguages: [null, null], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    // Everyone defaults to English, which is the spoken language, so
    // there is nothing to translate and no stream should start.
    expect(fake.upserts).toHaveLength(0);
    expect(fake.deletes).toContain(CLASS_ID);
  });

  it('ignores a language an admin has disabled', async () => {
    const { svc } = makeHarness({
      seatLanguages: ['hin', 'jpn'],
      enabledLanguages: ['eng', 'hin'],
      translatorUrl: fake.url,
    });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(upsert(fake, 0).langs).toEqual(['hin']);
  });

  it('caps at maxStreams, keeping the most-listened languages', async () => {
    const seatLanguages = [...Array(9).fill('hin'), ...Array(5).fill('ben'), ...Array(2).fill('tel'), 'tam'];
    const { svc } = makeHarness({ seatLanguages, maxStreams: 2, translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(upsert(fake, 0).langs).toEqual(['hin', 'ben']);
  });

  it('does nothing at all when the teacher has translation switched off', async () => {
    const { svc } = makeHarness({ seatLanguages: ['hin'], translationEnabled: false, translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(fake.upserts).toHaveLength(0);
  });

  it('points the translator at the class room and the teacher identity prefix', async () => {
    const { svc } = makeHarness({ seatLanguages: ['hin'], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(upsert(fake, 0).room).toBe(`class:${CLASS_ID}:broadcast`);
    // A prefix, not a track sid: the teacher republishes on every mic toggle.
    expect(upsert(fake, 0).sourceIdentityPrefix).toBe('st:teacher:');
  });

  it('coalesces a burst of triggers into one translator call', async () => {
    // A batch-scoped class start attaches 40 stations in a loop.
    const { svc } = makeHarness({ seatLanguages: ['hin'], translatorUrl: fake.url });
    for (let i = 0; i < 40; i++) svc.markDirty(CLASS_ID);
    await settle();
    expect(fake.upserts).toHaveLength(1);
  });
});

describe('TranslationService — convergence and failure', () => {
  let fake: FakeTranslator;

  beforeAll(async () => {
    fake = await startFakeTranslator();
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });
  beforeEach(() => fake.reset());

  it('keeps a language alive briefly after its last listener leaves', async () => {
    // A student walking between seats, or flicking through the dropdown,
    // must not tear down and restart a GPU stream.
    const { svc, prisma } = makeHarness({ seatLanguages: ['hin'], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    expect(upsert(fake, 0).langs).toEqual(['hin']);

    prisma.station.findMany.mockResolvedValue([{ id: 'st0', currentUser: { listenLanguage: 'eng' } }]);
    svc.markDirty(CLASS_ID);
    await settle();

    // Still requested — inside the grace window, not dropped.
    expect(upsert(fake, 1).langs).toEqual(['hin']);
    expect(fake.deletes).not.toContain(CLASS_ID);
  });

  it('still applies a change that lands on top of an in-flight reconcile', async () => {
    // Regression: a reconcile deferred because another was running used
    // to be put back in `dirty` WITHOUT re-arming the debounce, so it
    // waited for the 10s sweep. Live symptom: a student's language took
    // ten seconds to take effect, because the teacher's own toggle
    // reconciles a moment earlier. Two triggers in quick succession,
    // with the language changing between them, must converge promptly on
    // the LATER answer.
    const { svc, prisma } = makeHarness({ seatLanguages: ['eng'], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    prisma.station.findMany.mockResolvedValue([{ id: 'st0', currentUser: { listenLanguage: 'hin' } }]);
    svc.markDirty(CLASS_ID);
    await settle(1500); // well under the 10s sweep

    expect(fake.upserts.length).toBeGreaterThan(0);
    expect(upsert(fake, fake.upserts.length - 1).langs).toEqual(['hin']);
  });

  it('records an honest failure so students keep the original audio', async () => {
    const { svc, store } = makeHarness({ seatLanguages: ['hin'], translatorUrl: fake.url });
    fake.failNext = true;
    svc.markDirty(CLASS_ID);
    await settle();

    const state = store.get(CLASS_ID);
    expect(state?.engineOk).toBe(false);
    expect(state?.detail).toMatch(/503/);
    // And the seat is told why rather than being left on a spinner.
    const status = store.statusFor(CLASS_ID, 'hin', 'eng', true);
    expect(status.status).toBe('unavailable');
    expect(status.detail).toBeTruthy();
  });

  it('pushes a fresh snapshot to every seat when the teacher toggles translation', async () => {
    const { svc, gateway, prisma } = makeHarness({
      seatLanguages: ['hin', 'eng'],
      translationEnabled: false,
      translatorUrl: fake.url,
    });
    prisma.station.findMany.mockResolvedValue([{ id: 'st0' }, { id: 'st1' }]);
    await svc.setClassTranslation(CLASS_ID, true, 'eng');
    expect(gateway.pushSnapshot).toHaveBeenCalledTimes(2);
  });

  it('drops the translator session as soon as a class ends', async () => {
    const { svc } = makeHarness({ seatLanguages: ['hin'], translatorUrl: fake.url });
    svc.markDirty(CLASS_ID);
    await settle();
    await svc.teardownClass(CLASS_ID);
    expect(fake.deletes).toContain(CLASS_ID);
  });

  it('rejects a listening language the admin has not enabled', async () => {
    const { svc, prisma } = makeHarness({
      seatLanguages: ['eng'],
      enabledLanguages: ['eng', 'hin'],
      translatorUrl: fake.url,
    });
    await svc.setListenLanguage('st0', 'jpn');
    expect(prisma.user.update).not.toHaveBeenCalled();

    await svc.setListenLanguage('st0', 'hin');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { listenLanguage: 'hin' } }),
    );
  });

  it('is disabled entirely when no translator is configured', async () => {
    const { svc } = makeHarness({ seatLanguages: ['hin'], translatorUrl: '' });
    expect(svc.configured).toBe(false);
    svc.markDirty(CLASS_ID);
    await settle();
    expect(fake.upserts).toHaveLength(0);
  });
});

describe('TranslationStateStore.statusFor', () => {
  it('reports ready with no stream when the student picked the spoken language', () => {
    // The common case: the student hears the teacher directly, so no GPU
    // work and no added latency.
    const store = new TranslationStateStore();
    expect(store.statusFor(CLASS_ID, 'eng', 'eng', true).status).toBe('ready');
  });

  it('reports captions-only for a language the model cannot speak', () => {
    const store = new TranslationStateStore();
    store.set(CLASS_ID, {
      langs: new Map([['tam', { code: 'tam', listeners: 1, lagMs: 2000, state: 'live' }]]),
      engineOk: true,
    });
    expect(store.statusFor(CLASS_ID, 'tam', 'eng', false).status).toBe('captions-only');
  });

  it('reports starting while the stream spins up', () => {
    const store = new TranslationStateStore();
    store.set(CLASS_ID, {
      langs: new Map([['hin', { code: 'hin', listeners: 1, lagMs: null, state: 'starting' }]]),
      engineOk: true,
    });
    expect(store.statusFor(CLASS_ID, 'hin', 'eng', true).status).toBe('starting');
  });

  it('reports ready once the stream is live', () => {
    const store = new TranslationStateStore();
    store.set(CLASS_ID, {
      langs: new Map([['hin', { code: 'hin', listeners: 1, lagMs: 2400, state: 'live' }]]),
      engineOk: true,
    });
    expect(store.statusFor(CLASS_ID, 'hin', 'eng', true).status).toBe('ready');
  });

  it('reports unavailable with a reason when the stream failed', () => {
    const store = new TranslationStateStore();
    store.set(CLASS_ID, {
      langs: new Map([['hin', { code: 'hin', listeners: 1, lagMs: null, state: 'error', error: 'OOM' }]]),
      engineOk: true,
    });
    const status = store.statusFor(CLASS_ID, 'hin', 'eng', true);
    expect(status.status).toBe('unavailable');
    expect(status.detail).toBe('OOM');
  });
});
