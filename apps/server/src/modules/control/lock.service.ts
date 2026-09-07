import { Injectable } from '@nestjs/common';

export interface LockEntry {
  screen: boolean;
  input: boolean;
  message?: string;
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

  lock(stationId: string, entry: LockEntry): void {
    this.locks.set(stationId, entry);
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
