import { io, type Socket } from 'socket.io-client';
import { CONTROL_NAMESPACE, type ActivityEventPayload } from '@lab/shared/events';
import type { CommandAck, CommandEnvelope, DesiredStationState, StationHelloAck } from '@lab/shared';
import { getOrCreateBrowserMachineGuid, getRuntimeConfig } from './runtime-config';

const HEARTBEAT_INTERVAL_MS = 5_000;
const APP_VERSION = '0.1.0';

export interface StationControlEvents {
  onSnapshot: (snapshot: DesiredStationState) => void;
  onIdentity: (identity: { stationId: string; seatNo: number; displayName: string }) => void;
  onCommand: (envelope: CommandEnvelope) => void;
  onLockHeartbeat: (payload: { expiresAt: number }) => void;
  onRemoteControlStart?: (payload: { room: string; token: string }) => void;
  onRemoteControlStop?: (payload: { room: string }) => void;
  onActivityEvent?: (payload: ActivityEventPayload & { fromStationId: string }) => void;
  /** Fired once the station token first exists (and again on every
   * reconnect re-hello). Lets callers react to "the station is ready to
   * authenticate a claim" with real state instead of polling getToken()
   * on an interval (the pattern AssignmentsPanel/StudyLibraryPanel used
   * before the student sign-in gate existed). */
  onToken?: (token: string) => void;
  /** The server ended this station's classroom membership — either the
   * teacher ended the whole class, or an admin/teacher force-released
   * this seat (see ClassroomService). StudentConsole reacts by clearing
   * the local student session, which brings back the sign-in screen. */
  onSignedOut?: (payload: { reason: 'class_ended' | 'released' }) => void;
}

/**
 * The browser-side twin of apps/desktop's ControlClient (design doc
 * §4.1-4.4) — same station:hello/heartbeat/session:snapshot contract,
 * reused as-is here so the student console works identically whether
 * it's loaded in a real browser (dev/testing — see runtime-config's
 * machineGuid comment) or inside the Electron renderer, where
 * window.__LAB__.machineGuid is the SAME identity the main process
 * already registered — both connections resolve to one Station row
 * (register() upserts on machineGuid), so this is a second live socket
 * for the same station, not a duplicate identity.
 */
export class StationControlClient {
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentLockState = { screen: false, input: false };
  private currentActivityId: string | null = null;
  private stationToken: string | null = null;

  constructor(private readonly events: StationControlEvents) {}

  /** Phase 3 — the station's own credential (auth.service.ts's
   * mintStationToken), re-minted on every hello. Used by
   * apps/web/src/lib/station-api.ts for the student console's own
   * authenticated calls (attempts, recordings) — never for dashboard routes. */
  getToken(): string | null {
    return this.stationToken;
  }

  connect(): void {
    const { serverUrl } = getRuntimeConfig();
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    this.socket = io(`${wsUrl}${CONTROL_NAMESPACE}`, {
      auth: (cb) => cb({ token: this.stationToken ?? 'station-unauthenticated-no-token-yet' }),
      reconnection: true,
      reconnectionDelay: 2_000,
    });

    this.socket.on('connect', () => this.sendHello());
    this.socket.on('session:snapshot', (snapshot: DesiredStationState) => {
      this.currentLockState = { screen: snapshot.lock?.screen ?? false, input: snapshot.lock?.input ?? false };
      this.currentActivityId = snapshot.activity?.instanceId ?? null;
      this.events.onSnapshot(snapshot);
    });
    this.socket.on('station:identity', this.events.onIdentity);
    this.socket.on('command', (envelope: CommandEnvelope) => this.events.onCommand(envelope));
    this.socket.on('lock:heartbeat', (payload: { expiresAt: number }) => this.events.onLockHeartbeat(payload));
    this.socket.on('remote-control:start', (payload: { room: string; token: string }) => this.events.onRemoteControlStart?.(payload));
    this.socket.on('remote-control:stop', (payload: { room: string }) => this.events.onRemoteControlStop?.(payload));
    this.socket.on('activity:event', (payload: ActivityEventPayload & { fromStationId: string }) => this.events.onActivityEvent?.(payload));
    this.socket.on('student:signed-out', (payload: { reason: 'class_ended' | 'released' }) => this.events.onSignedOut?.(payload));

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  ackCommand(ack: CommandAck): void {
    this.socket?.emit('command:ack', ack);
  }

  sendActivityEvent(payload: ActivityEventPayload): void {
    this.socket?.emit('activity:event', payload);
  }

  /** Ser 8 (Phase 5) — reports which published track this station just
   * subscribed to for conference interpreting (see
   * ConferenceInterpretingActivity); purely observational, see the
   * gateway handler's own doc comment. */
  sendInterpSelectChannel(payload: { sessionId: string; trackSid: string }): void {
    this.socket?.emit('interp:selectChannel', payload);
  }

  private sendHello(): void {
    const machineGuid = getOrCreateBrowserMachineGuid();
    this.socket?.emit(
      'station:hello',
      {
        machineGuid,
        hostname: `browser-${machineGuid.slice(0, 8)}`,
        macs: ['00:00:00:00:00:00'], // browsers cannot read real MAC addresses — dev/test path only
        appVersion: APP_VERSION,
        osBuild: navigator.userAgent,
        displays: [{ id: '0', width: window.screen.width, height: window.screen.height, scaleFactor: window.devicePixelRatio }],
      },
      (ack: StationHelloAck) => {
        this.stationToken = ack.token;
        this.events.onToken?.(ack.token);
        // eslint-disable-next-line no-console
        console.log('[station-control] registered', { stationId: ack.stationId, seatNo: ack.seatNo });
      },
    );
  }

  private sendHeartbeat(): void {
    this.socket?.emit('station:heartbeat', {
      seq: Date.now(),
      metrics: { cpu: 0, mem: 0, rttMs: 0 },
      lockState: this.currentLockState,
      activityId: this.currentActivityId,
    });
  }

  disconnect(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.disconnect();
  }
}
