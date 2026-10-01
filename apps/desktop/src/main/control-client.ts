import { io, type Socket } from 'socket.io-client';
import os from 'node:os';
import { app, screen } from 'electron';
import { CONTROL_NAMESPACE } from '@lab/shared/events';
import type { CommandAck, CommandEnvelope, DesiredStationState, StationHello, StationHelloAck } from '@lab/shared';
import { getHostname, getMacAddresses } from './station-identity';

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface ControlClientEvents {
  onSnapshot: (snapshot: DesiredStationState) => void;
  onIdentity: (identity: { stationId: string; seatNo: number; displayName: string }) => void;
  onCommand: (envelope: CommandEnvelope) => void;
  onLockHeartbeat: (payload: { expiresAt: number }) => void;
  /** Drives the Disable overlay's own failsafe (it carries no lock lease
   * to renew) — see LockOverlayManager's doc comment. */
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * The station-side half of the /control contract (design doc §4.1-4.4).
 * Deliberately its own connection, independent of any future LiveKit
 * media connection — the unlock failsafe cannot depend on WebRTC being
 * up, and this socket is where lock-lease renewal (§3.3) arrives.
 *
 * Auth: station:hello mints a fresh station-scoped JWT on every call
 * (Phase 3 — auth.service.ts's mintStationToken) and this client stores
 * it for two things: presenting it on the NEXT (re)connect's handshake
 * (so ControlGateway.handleConnection can identify the socket as a
 * station immediately, before hello even runs — see its own comment on
 * why that categorization must be correct), and handing it to
 * command-handler.ts for the station's own authenticated HTTP calls
 * (PUSH_FILE fetching a media asset). The very first connection ever has
 * no token yet, hence the placeholder fallback.
 */
export class ControlClient {
  private socket: Socket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentLockState = { screen: false, input: false };
  private currentActivityId: string | null = null;
  private stationToken: string | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly machineGuid: string,
    private readonly events: ControlClientEvents,
  ) {}

  getServerUrl(): string {
    return this.serverUrl;
  }

  getToken(): string | null {
    return this.stationToken;
  }

  async connect(): Promise<void> {
    const machineGuid = this.machineGuid;
    const wsUrl = this.serverUrl.replace(/^http/, 'ws');
    this.socket = io(`${wsUrl}${CONTROL_NAMESPACE}`, {
      // Function form (not a plain object) so a reconnect re-reads
      // this.stationToken at connect time, not whatever it was when
      // connect() first ran (which is always null — hello hasn't happened yet).
      auth: (cb) => cb({ token: this.stationToken ?? 'station-unauthenticated-no-token-yet' }),
      reconnection: true,
      reconnectionDelay: 2_000,
      rejectUnauthorized: false,
    });

    this.socket.on('connect', () => {
      this.sendHello(machineGuid);
      this.events.onConnect?.();
    });
    this.socket.on('disconnect', () => this.events.onDisconnect?.());
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
      this.stationToken = ack.token;
      // eslint-disable-next-line no-console
      console.log('[control-client] registered', { stationId: ack.stationId, seatNo: ack.seatNo });
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
