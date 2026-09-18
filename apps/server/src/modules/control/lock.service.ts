import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface LockEntry {
  /** Identifies this particular lock — a fresh id per lock() call, so the
   * station can tell a new Lock click apart from the same lock re-sent in
   * a later snapshot (snapshots are pushed for many unrelated reasons). */
  id: string;
  screen: boolean;
  input: boolean;
  message?: string;
  lockedBy: string;
  lockedAt: number;
}

export interface LockInput {
  screen: boolean;
  input: boolean;
  message?: string;
  lockedBy: string;
}

/**
 * The lock is a LEASE, not a LATCH (design doc §3.3 — the most important
 * safety property in the system). This service holds only in-memory
 * intent ("teacher wants station X locked"); ControlGateway's heartbeat
 * timer is what actually keeps a lock alive by re-pushing `lock:heartbeat`
 * with a fresh short expiry every 15s. If the server crashes or this
 * process dies, the timer simply stops — the client's existing expiry
 * lapses within 30s and it self-unlocks. No unlock code path needs to
 * run for the failsafe to work; that is the point.
 */
@Injectable()
export class LockService {
  private readonly locks = new Map<string, LockEntry>();

  lock(stationId: string, entry: LockInput): void {
    this.locks.set(stationId, { ...entry, id: randomUUID(), lockedAt: Date.now() });
  }

  unlock(stationId: string): void {
    this.locks.delete(stationId);
  }

  get(stationId: string): LockEntry | null {
    return this.locks.get(stationId) ?? null;
  }

  listLockedStationIds(): string[] {
    return Array.from(this.locks.keys());
  }
}
