import { Injectable, Logger } from '@nestjs/common';
import { StationLifecycle, type StationStatusRow } from '@lab/shared';
import { LockService } from './lock.service';
import { ScreenShareService } from './screen-share.service';

interface PresenceEntry {
  stationId: string;
  seatNo: number | null;
  /** A packaged Electron station opens TWO sockets with the same
   * machineGuid — the main process and the renderer both call
   * station:hello. Tracking every live socket id (rather than just the
   * most recent one) is what lets a renderer reload/reconnect survive
   * without the station briefly reading OFFLINE: the entry is only ever
   * torn down once this set empties, not when any one socket drops. */
  socketIds: Set<string>;
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

/** Fired when a station appears (first socket) or disappears (last socket
 * dropped, missed heartbeats, or explicit remove). */
export type PresenceListener = (stationId: string, online: boolean) => void;

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
  private readonly listeners = new Set<PresenceListener>();

  constructor(
    private readonly locks: LockService,
    private readonly screenShares: ScreenShareService,
  ) {}

  /** Subscribe to online/offline transitions (Round Table's chairman/speaker
   * disconnect handling). Returns an unsubscribe function. */
  onChange(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(stationId: string, online: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(stationId, online);
      } catch (err) {
        this.logger.error(`presence listener failed for ${stationId}`, err as Error);
      }
    }
  }

  upsert(entry: Omit<PresenceEntry, 'missedHeartbeats' | 'socketIds'> & { socketId: string }): void {
    const { socketId, ...rest } = entry;
    const existing = this.byStation.get(entry.stationId);
    const socketIds = existing?.socketIds ?? new Set<string>();
    socketIds.add(socketId);
    this.byStation.set(entry.stationId, { ...rest, socketIds, missedHeartbeats: existing?.missedHeartbeats ?? 0 });
    if (!existing) this.notify(entry.stationId, true);
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

  /** An admin renumbered this station (ControlController.changeSeat) —
   * keep the cached seat in step. No-op when the station is offline. */
  setSeatNo(stationId: string, seatNo: number): void {
    const entry = this.byStation.get(stationId);
    if (entry) entry.seatNo = seatNo;
  }

  remove(stationId: string): void {
    if (this.byStation.delete(stationId)) this.notify(stationId, false);
  }

  /** Drops one of a station's (possibly several) live sockets. Returns
   * `true` only when that was the last one — the caller (ControlGateway's
   * handleDisconnect) must treat that, and only that, as "the station
   * actually went offline": a renderer reload dropping its own socket
   * while the main-process socket stays up must NOT tear down presence,
   * or a live PC would briefly read OFFLINE on the dashboard for no
   * reason (heartbeat() also no-ops without an entry, so the surviving
   * socket couldn't resurrect it either). */
  removeSocket(stationId: string, socketId: string): boolean {
    const entry = this.byStation.get(stationId);
    if (!entry) return false;
    entry.socketIds.delete(socketId);
    if (entry.socketIds.size > 0) return false;
    this.byStation.delete(stationId);
    this.notify(stationId, false);
    return true;
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
          this.notify(stationId, false);
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
      screenSharing: this.screenShares.isPresenting(stationId),
    };
  }

  listOnlineStationIds(): string[] {
    return Array.from(this.byStation.keys());
  }
}
