import { Injectable, Logger } from '@nestjs/common';
import { StationLifecycle, type StationStatusRow } from '@lab/shared';
import { LockService } from './lock.service';

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
  /** The teacher whose LiveClass this station currently belongs to (or
   * null). Seeded from StationsService.register at hello and kept live by
   * setMembership — this is what lets ControlGateway route a status delta
   * to `dash:<teacherId>` without a DB round trip on every heartbeat. */
  classTeacherId: string | null;
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

  constructor(private readonly locks: LockService) {}

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

  /** Called right after a classroom sign-in/sign-out changes which seat or
   * class a station belongs to, so live status deltas route correctly
   * before the next hello. No-ops if the station isn't currently online
   * (its next station:hello will re-derive this from the DB anyway). */
  setMembership(stationId: string, patch: { seatNo: number; classTeacherId: string | null }): void {
    const entry = this.byStation.get(stationId);
    if (!entry) return;
    entry.seatNo = patch.seatNo;
    entry.classTeacherId = patch.classTeacherId;
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

  /** Called on a timer; returns the stations that just crossed the offline
   * threshold, along with the classTeacherId each one had — captured here,
   * before the entry is deleted, since ControlGateway needs it to route
   * the resulting status delta to that teacher's dashboard room. */
  sweepMissedHeartbeats(): Array<{ stationId: string; classTeacherId: string | null }> {
    const now = Date.now();
    const wentOffline: Array<{ stationId: string; classTeacherId: string | null }> = [];
    for (const [stationId, entry] of this.byStation) {
      if (now - entry.lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
        entry.missedHeartbeats += 1;
        if (entry.missedHeartbeats >= OFFLINE_AFTER_MISSES) {
          wentOffline.push({ stationId, classTeacherId: entry.classTeacherId });
          this.byStation.delete(stationId);
        }
      }
    }
    return wentOffline;
  }

  /** Derives `lock`/lifecycle from LockService — the server's own intent
   * — rather than the station's self-reported heartbeat.lockState. A lock
   * or unlock takes effect here the instant ControlController applies it,
   * not after the next 5s heartbeat round-trip, and a heartbeat already in
   * flight when a lock/unlock happens can't clobber it with a stale value. */
  toStatusPatch(stationId: string): Partial<StationStatusRow> & { stationId: string } {
    const entry = this.byStation.get(stationId);
    if (!entry) {
      return { stationId, lifecycle: StationLifecycle.OFFLINE, lock: null };
    }
    const lockEntry = this.locks.get(stationId);
    const lock = lockEntry ? { screen: lockEntry.screen, input: lockEntry.input } : null;
    return {
      stationId,
      seatNo: entry.seatNo,
      lifecycle: lock && (lock.screen || lock.input) ? StationLifecycle.LOCKED : StationLifecycle.READY,
      appVersion: entry.appVersion,
      osBuild: entry.osBuild,
      ip: entry.ip,
      lastSeenAt: entry.lastHeartbeatAt,
      lock,
    };
  }

  listOnlineStationIds(): string[] {
    return Array.from(this.byStation.keys());
  }
}
