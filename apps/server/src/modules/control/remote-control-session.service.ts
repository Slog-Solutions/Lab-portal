import { Injectable } from '@nestjs/common';

/**
 * Reference-counts concurrent remote-control "start" calls per station.
 * In-memory only, same posture as LockService — this is a live count of
 * intent, not a persisted resource, and a server restart legitimately
 * resets it to zero along with the LiveKit rooms it guards.
 *
 * Exists because `ctrl:<stationId>` is a single room shared by every
 * "start" for that station: React StrictMode double-invokes
 * RemoteControlView's effect (mount, mount, cleanup-of-first-mount), and
 * in production the same shape occurs whenever a teacher closes the view
 * while a start is still in flight, or a second teacher/tab opens the
 * same seat. Without a count, the first stop to arrive deletes the room
 * out from under whichever start is still active — confirmed live via
 * the audit log (two starts 3ms apart, a stop 1ms after that, LiveKit
 * left holding no ctrl: room at all). `stop()` only reports "tear down
 * for real" once every start has been matched by a stop.
 */
@Injectable()
export class RemoteControlSessionService {
  private readonly counts = new Map<string, number>();

  /** Call when a "start" is issued. */
  start(stationId: string): void {
    this.counts.set(stationId, (this.counts.get(stationId) ?? 0) + 1);
  }

  /** Call when a "stop" is issued. Returns true only when the count has
   * reached zero — that is the caller's signal to actually emit
   * `remote-control:stop` and delete the LiveKit room. A stop with no
   * matching start (count already 0) is treated as a no-op stop, not a
   * teardown — it cannot rightfully own anything to tear down. */
  stop(stationId: string): boolean {
    const current = this.counts.get(stationId) ?? 0;
    if (current <= 1) {
      this.counts.delete(stationId);
      return current === 1;
    }
    this.counts.set(stationId, current - 1);
    return false;
  }
}
