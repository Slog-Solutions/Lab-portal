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
 */

interface SimArgs {
  count: number;
  server: string;
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
  };
}

interface VirtualStation {
  id: number;
  machineGuid: string;
  socket: Socket;
  connectedAt?: number;
  stationId?: string;
  seatNo?: number | null;
}

async function main(): Promise<void> {
  const { count, server } = parseArgs();
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
