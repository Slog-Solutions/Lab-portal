import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { CONTROL_NAMESPACE } from '@lab/shared/events';
import type { StationHelloAck } from '@lab/shared';

/**
 * Headless N-station load harness (build plan "Verification" — doubles
 * as the Ser 11 demo rig). Drives real socket.io connections against the
 * real /control gateway using the exact StationHello contract a real
 * Electron client sends, so this exercises apps/server's presence
 * tracking, seat lookup and heartbeat sweep honestly — no server-side
 * mocking.
 *
 * Usage: npm run sim -- --count 40 --server http://localhost:3000
 * Phase 5: npm run sim -- --count 40 --with-session
 *   also arms a real 6-group session across every connected station
 *   (Ser 1 "six independent, simultaneous sessions" at full 40-seat
 *   scale) with a real mix of activity types, and times how long
 *   SessionsService.arm()'s full snapshot fan-out to every station takes
 *   — this pass's actual load-test gap: prior runs only ever proved
 *   connection/presence/heartbeat at 41 seats (see Phase 0 close-out),
 *   never a real session touching every seat at once.
 */

interface SimArgs {
  count: number;
  server: string;
  withSession: boolean;
}

function parseArgs(): SimArgs {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
  };
  return {
    count: parseInt(get('--count', '40'), 10),
    server: get('--server', 'http://localhost:3000'),
    withSession: args.includes('--with-session'),
  };
}

interface VirtualStation {
  id: number;
  machineGuid: string;
  socket: Socket;
  connectedAt?: number;
  stationId?: string;
  seatNo?: number | null;
  snapshotSeq?: number;
}

async function api<T>(server: string, path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${server}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

/** Arms one real 6-group session across every connected station (Ser 1
 * at full scale), with a real mix of activity types, and reports how
 * long the full snapshot fan-out actually took. */
async function armLoadTestSession(server: string, stations: VirtualStation[]): Promise<void> {
  const ready = stations.filter((s) => s.stationId);
  if (ready.length < 2) {
    console.warn('[sim] --with-session needs at least 2 acked stations, skipping');
    return;
  }

  const { accessToken: teacherToken } = await api<{ accessToken: string }>(server, '/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ serviceNumber: 'TCH-001', password: 'Teacher@12345' }),
  });
  const batches = await api<Array<{ id: string }>>(server, '/sessions/batches', teacherToken);
  if (!batches[0]) throw new Error('No seeded batch found — run prisma:seed first');

  const groupCount = Math.min(6, ready.length);
  const groups: Array<{ id: string[]; kind: string }> = Array.from({ length: groupCount }, (_, i) => ({
    id: [],
    kind: ['CONFERENCE_INTERPRETING', 'ROUND_TABLE', 'TELEPHONE', 'VOCABULARY_TEST', 'ROUND_TABLE', 'TELEPHONE'][i]!,
  }));
  ready.forEach((s, i) => groups[i % groupCount]!.id.push(s.stationId!));

  const groupPayload = groups
    .filter((g) => g.id.length > 0)
    .map((g, index) => {
      const base = { index: index + 1, memberStationIds: g.id };
      switch (g.kind) {
        case 'CONFERENCE_INTERPRETING':
          return {
            ...base,
            activityType: g.kind,
            activityConfig: {
              topic: 'Load-test summit',
              languages: ['fr'],
              roles: g.id.map((stationId, i2) => ({
                stationId,
                role: i2 === 0 ? 'DELEGATE' : i2 === 1 ? 'INTERPRETER' : 'OBSERVER',
                lang: i2 === 1 ? 'fr' : undefined,
              })),
            },
          };
        case 'TELEPHONE':
          return { ...base, activityType: g.kind, activityConfig: { scenario: 'Load-test call', maxDurationSec: 300 } };
        case 'VOCABULARY_TEST':
          return { ...base, activityType: g.kind, activityConfig: { items: [{ prompt: 'load', answer: 'test' }], shuffleItems: false } };
        default:
          return { ...base, activityType: g.kind, activityConfig: { topic: 'Load-test discussion', chairmanAssignment: 'manual', micRequestQueueEnabled: true } };
      }
    });

  console.log(`[sim] arming a ${groupPayload.length}-group session across ${ready.length} stations…`);
  const snapshotPromises = ready.map(
    (s) =>
      new Promise<void>((resolve) => {
        s.socket.once('session:snapshot', () => resolve());
      }),
  );

  const session = await api<{ id: string }>(server, '/sessions', teacherToken, {
    method: 'POST',
    body: JSON.stringify({ title: `Load test ${new Date().toISOString()}`, batchId: batches[0].id, groups: groupPayload }),
  });

  const armStarted = Date.now();
  await api(server, `/sessions/${session.id}/arm`, teacherToken, { method: 'POST' });
  await Promise.all(snapshotPromises);
  console.log(`[sim] all ${ready.length} stations received a post-arm snapshot in ${Date.now() - armStarted}ms`);

  await api(server, `/sessions/${session.id}/end`, teacherToken, { method: 'POST' });
  console.log('[sim] session ended, LiveKit rooms torn down');
}

async function main(): Promise<void> {
  const { count, server, withSession } = parseArgs();
  const wsUrl = server.replace(/^http/, 'ws');
  console.log(`[sim] spinning up ${count} virtual stations against ${wsUrl}${CONTROL_NAMESPACE}`);

  const stations: VirtualStation[] = [];
  let helloAcked = 0;

  for (let i = 1; i <= count; i++) {
    const machineGuid = randomUUID();
    const socket = io(`${wsUrl}${CONTROL_NAMESPACE}`, {
      auth: { token: 'sim-unauthenticated' },
      reconnection: true,
    });
    const station: VirtualStation = { id: i, machineGuid, socket };
    stations.push(station);

    socket.on('connect', () => {
      station.connectedAt = Date.now();
      socket.emit(
        'station:hello',
        {
          machineGuid,
          hostname: `SIM-${String(i).padStart(3, '0')}`,
          macs: [randomMac()],
          appVersion: '0.1.0-sim',
          osBuild: 'sim',
          displays: [{ id: '0', width: 1920, height: 1080, scaleFactor: 1 }],
        },
        (ack: StationHelloAck) => {
          helloAcked += 1;
          station.stationId = ack.stationId;
          station.seatNo = ack.seatNo;
          if (helloAcked === count) {
            console.log(`[sim] all ${count} stations registered and acked`);
            if (withSession) void armLoadTestSession(server, stations).catch((err) => console.error('[sim] --with-session failed:', err));
          }
        },
      );

      setInterval(() => {
        socket.emit('station:heartbeat', {
          seq: Date.now(),
          metrics: { cpu: Math.random() * 20, mem: Math.random() * 40, rttMs: Math.random() * 10 },
          lockState: { screen: false, input: false },
          activityId: null,
        });
      }, 5_000);
    });

    socket.on('connect_error', (err) => {
      console.error(`[sim] station ${i} connect_error:`, err.message);
    });

    // Stagger connections slightly so the server doesn't see 40
    // simultaneous handshakes in the same tick — closer to how real
    // stations power on across a lab.
    await sleep(50);
  }

  process.on('SIGINT', () => {
    console.log('\n[sim] shutting down virtual stations…');
    for (const s of stations) s.socket.disconnect();
    process.exit(0);
  });

  setInterval(() => {
    const online = stations.filter((s) => s.socket.connected).length;
    console.log(`[sim] ${online}/${count} connected, ${helloAcked} acked`);
  }, 15_000);
}

function randomMac(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join(':');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[sim] fatal error:', err);
  process.exit(1);
});
