import { Injectable, Logger } from '@nestjs/common';
import { StationLifecycle, type StationStatusRow } from '@lab/shared';

interface PresenceEntry {
  stationId: string;
  seatNo: number | null;
  socketId: string;
  appVersion: string;
  osBuild: string;
  ip: string | null;
  lastHeartbeatAt: number;
  missedHeartbeats: number;
  lockState: { screen: boolean; input: boolean };
  activityId: string | null;
}

const HEARTBEAT_INTERVAL_MS = 5_000;
const OFFLINE_AFTER_MISSES = 3; // 15s, matches design doc §4.4

/**
 * In-memory presence — deliberately NOT persisted per-heartbeat (that
 * would be 41 writes every 5s for no benefit). Station.lifecycle in
 * Postgres is updated only on meaningful transitions (join/leave/lock).
 * A server restart loses live presence, which is correct: stations
 * re-send station:hello within seconds of reconnecting.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly byStation = new Map<string, PresenceEntry>();

  upsert(entry: Omit<PresenceEntry, 'missedHeartbeats'>): void {
    const existing = this.byStation.get(entry.stationId);
    this.byStation.set(entry.stationId, { ...entry, missedHeartbeats: existing?.missedHeartbeats ?? 0 });
  }

  heartbeat(
    stationId: string,
    patch: { lockState: PresenceEntry['lockState']; activityId: string | null },
  ): void {
    const entry = this.byStation.get(stationId);
    if (!entry) return;
    entry.lastHeartbeatAt = Date.now();
    entry.missedHeartbeats = 0;
    entry.lockState = patch.lockState;
    entry.activityId = patch.activityId;
  }

  remove(stationId: string): void {
    this.byStation.delete(stationId);
  }

  get(stationId: string): PresenceEntry | undefined {
    return this.byStation.get(stationId);
  }

  isOnline(stationId: string): boolean {
    return this.byStation.has(stationId);
  }

  /** Called on a timer; returns stationIds that just crossed the offline threshold. */
  sweepMissedHeartbeats(): string[] {
    const now = Date.now();
    const wentOffline: string[] = [];
    for (const [stationId, entry] of this.byStation) {
      if (now - entry.lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
        entry.missedHeartbeats += 1;
        if (entry.missedHeartbeats >= OFFLINE_AFTER_MISSES) {
          this.byStation.delete(stationId);
          wentOffline.push(stationId);
        }
      }
    }
    return wentOffline;
  }

  toStatusPatch(stationId: string): Partial<StationStatusRow> & { stationId: string } {
    const entry = this.byStation.get(stationId);
    if (!entry) {
      return { stationId, lifecycle: StationLifecycle.OFFLINE, lock: null };
    }
    return {
      stationId,
      seatNo: entry.seatNo,
      lifecycle: entry.lockState.screen || entry.lockState.input ? StationLifecycle.LOCKED : StationLifecycle.READY,
      appVersion: entry.appVersion,
      osBuild: entry.osBuild,
      ip: entry.ip,
      lastSeenAt: entry.lastHeartbeatAt,
      lock: entry.lockState,
    };
  }

  listOnlineStationIds(): string[] {
    return Array.from(this.byStation.keys());
  }
}
