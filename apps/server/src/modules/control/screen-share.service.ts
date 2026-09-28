import { Injectable } from '@nestjs/common';

export interface ScreenShareEntry {
  stationId: string;
  mic: boolean;
  startedAt: number;
}

/**
 * Reference tracking for the teacher "spotlight a student's screen to the
 * class" feature (Ser 1 "broadcast any student's screen to others").
 * In-memory only, same posture as LockService and
 * RemoteControlSessionService — this is a live count of intent, not a
 * persisted resource, and a server restart legitimately resets it to zero
 * along with the LiveKit `canPublishSources` grants it guards.
 *
 * Deliberately ONE presenter per room: a room here is a class's
 * lab:broadcast-equivalent, and putting two students' screens up at once
 * would just mean two ScreenShare tracks racing for the same slot in every
 * student console's UI. `set()` is how that single-slot rule is enforced —
 * it hands the caller back whoever was presenting before, so the caller
 * (ControlController) can revoke that station's publish grant and tell it
 * to stop before granting the new one.
 */
@Injectable()
export class ScreenShareService {
  private readonly byRoom = new Map<string, ScreenShareEntry>();

  /** Sets `stationId` as the sole presenter in `room`. Returns the
   * previously-presenting stationId in this room, if different, so the
   * caller can revoke and notify it. */
  set(room: string, stationId: string, mic: boolean): { previousStationId: string | null } {
    const existing = this.byRoom.get(room);
    const previousStationId = existing && existing.stationId !== stationId ? existing.stationId : null;
    this.byRoom.set(room, { stationId, mic, startedAt: Date.now() });
    return { previousStationId };
  }

  /** The room a station is currently presenting into, or null. */
  getRoomFor(stationId: string): string | null {
    for (const [room, entry] of this.byRoom) {
      if (entry.stationId === stationId) return room;
    }
    return null;
  }

  isPresenting(stationId: string): boolean {
    return this.getRoomFor(stationId) !== null;
  }

  clearRoom(room: string): void {
    this.byRoom.delete(room);
  }

  /** Clears whichever room `stationId` is presenting into, if any. Used
   * when the presenting station itself goes away (disconnect, release from
   * seat) rather than being explicitly revoked. */
  clearByStation(stationId: string): void {
    const room = this.getRoomFor(stationId);
    if (room) this.byRoom.delete(room);
  }
}
