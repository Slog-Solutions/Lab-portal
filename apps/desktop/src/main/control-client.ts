import { io, type Socket } from 'socket.io-client';
import os from 'node:os';
import { app, screen } from 'electron';
import { CONTROL_NAMESPACE } from '@lab/shared/events';
import type { CommandAck, CommandEnvelope, DesiredStationState, StationHello, StationHelloAck } from '@lab/shared';
import { getHostname, getMacAddresses, getOrCreateMachineGuid } from './station-identity';

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface ControlClientEvents {
  onSnapshot: (snapshot: DesiredStationState) => void;
  onIdentity: (identity: { stationId: string; seatNo: number; displayName: string }) => void;
  onCommand: (envelope: CommandEnvelope) => void;
  onLockHeartbeat: (payload: { expiresAt: number }) => void;
}

/**
 * The station-side half of the /control contract (design doc §4.1-4.4).
 * Deliberately its own connection, independent of any future LiveKit
 * media connection — the unlock failsafe cannot depend on WebRTC being
 * up, and this socket is where lock-lease renewal (§3.3) arrives.
 *
 * Auth today: no station token yet (Phase 1 hardens this to a signed,
 * short-TTL station credential minted at seat assignment). station:hello
 * itself is what the server's gateway uses to look up/create the Station
 * row — see apps/server ControlGateway.handleHello.
 */
export class ControlClient {
  private socket: Socket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentLockState = { screen: false, input: false };
  private currentActivityId: string | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly userDataDir: string,
    private readonly events: ControlClientEvents,
  ) {}

  async connect(): Promise<void> {
    const machineGuid = await getOrCreateMachineGuid(this.userDataDir);
    const wsUrl = this.serverUrl.replace(/^http/, 'ws');
    this.socket = io(`${wsUrl}${CONTROL_NAMESPACE}`, {
      auth: { token: 'station-unauthenticated-phase0' },
      reconnection: true,
      reconnectionDelay: 2_000,
    });

    this.socket.on('connect', () => this.sendHello(machineGuid));
    this.socket.on('session:snapshot', (snapshot: DesiredStationState) => {
      this.currentLockState = {
        screen: snapshot.lock?.screen ?? false,
        input: snapshot.lock?.input ?? false,
      };
      this.currentActivityId = snapshot.activity?.instanceId ?? null;
      this.events.onSnapshot(snapshot);
    });
    this.socket.on('station:identity', this.events.onIdentity);
    this.socket.on('command', (envelope: CommandEnvelope) => this.events.onCommand(envelope));
    this.socket.on('lock:heartbeat', (payload: { expiresAt: number }) => this.events.onLockHeartbeat(payload));

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  ackCommand(ack: CommandAck): void {
    this.socket?.emit('command:ack', ack);
  }

  private sendHello(machineGuid: string): void {
    const hello: StationHello = {
      machineGuid,
      hostname: getHostname(),
      macs: getMacAddresses(),
      appVersion: app.getVersion(),
      osBuild: `${os.platform()} ${os.release()}`,
      displays: screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        width: d.bounds.width,
        height: d.bounds.height,
        scaleFactor: d.scaleFactor,
      })),
    };
    this.socket?.emit('station:hello', hello, (ack: StationHelloAck) => {
      // eslint-disable-next-line no-console
      console.log('[control-client] registered', ack);
    });
  }

  private sendHeartbeat(): void {
    this.socket?.emit('station:heartbeat', {
      seq: Date.now(),
      metrics: { cpu: 0, mem: 0, rttMs: 0 }, // real sampling lands with the native-bridge integration (Phase 1)
      lockState: this.currentLockState,
      activityId: this.currentActivityId,
    });
  }

  disconnect(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.disconnect();
  }
}
