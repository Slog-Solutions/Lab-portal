import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface LockEntry {
  /** Identifies this particular lock — a fresh id per lock() call, so the
   * station can tell a new Lock click apart from the same lock re-sent in
   * a later snapshot (snapshots are pushed for many unrelated reasons). */
  id: string;
  /** 'soft'    = app overlay + OS input suppression; the teacher's Unlock releases it.
   *  'windows' = real LockWorkStation; only the student's Windows password releases it. */
  mode: 'soft' | 'windows';
  screen: boolean;
  input: boolean;
  message?: string;
  lockedBy: string;
  lockedAt: number;
}

export interface LockInput {
  mode: 'soft' | 'windows';
  screen: boolean;
  input: boolean;
  message?: string;
  lockedBy: string;
}

/**
 * The lock is a LEASE, not a LATCH (design doc §3.3 — the most important
 * safety property in the system). ControlGateway's heartbeat timer is what
 * actually keeps a lock alive by re-pushing `lock:heartbeat` with a fresh
 * short expiry every 15s. If the server crashes or this process dies, the
 * timer simply stops — the client's existing expiry lapses within 30s and
 * it self-unlocks. No unlock code path needs to run for the failsafe to
 * work; that is the point.
 *
 * Persisted to Postgres as INTENT ONLY — the LockGrant table exists so a
 * restarted server can re-assert every lock it was holding, not so a dead
 * server can somehow keep enforcing one (it can't; see above). The
 * in-memory maps below stay the hot path: `get()` MUST remain synchronous
 * because PresenceService.toStatusPatch and SessionStateService.getDesiredState
 * call it from sync/post-await contexts and cannot themselves become async
 * just to satisfy this one dependency.
 *
 * A lock is scoped to whichever of a station or its currently-seated
 * student makes more sense (build plan "teacher-wide remote control"):
 *  - `byUser`: follows a signed-in student to whatever seat they move to.
 *  - `byStation`: an explicit "lock this PC" with nobody signed in.
 *  - `seatOccupant`: which userId currently sits at which stationId — this
 *    is what lets `get(stationId)` resolve an inherited student lock, and
 *    what `listLockedStationIds()` must resolve through too, or an
 *    inherited lock would never be renewed by the heartbeat and would
 *    silently self-release after 30s even though the teacher never
 *    clicked Unlock.
 */
@Injectable()
export class LockService implements OnModuleInit {
  private readonly logger = new Logger(LockService.name);
  private readonly byStation = new Map<string, LockEntry>();
  private readonly byUser = new Map<string, LockEntry>();
  private readonly seatOccupant = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const [grants, occupied] = await Promise.all([
      this.prisma.lockGrant.findMany(),
      this.prisma.station.findMany({ where: { currentUserId: { not: null } }, select: { id: true, currentUserId: true } }),
    ]);
    for (const s of occupied) {
      if (s.currentUserId) this.seatOccupant.set(s.id, s.currentUserId);
    }
    for (const grant of grants) {
      const entry: LockEntry = {
        id: grant.id,
        mode: grant.mode === 'windows' ? 'windows' : 'soft',
        screen: grant.screen,
        input: grant.input,
        message: grant.message ?? undefined,
        lockedBy: grant.lockedById,
        lockedAt: grant.lockedAt.getTime(),
      };
      if (grant.userId) this.byUser.set(grant.userId, entry);
      else if (grant.stationId) this.byStation.set(grant.stationId, entry);
    }
    this.logger.log(`Rehydrated ${grants.length} lock grant(s) from Postgres`);
  }

  /** Reads `station.currentUserId` itself so callers (ControlController)
   * don't need to resolve occupancy first — writes a USER-scoped grant
   * when someone is seated, a STATION-scoped one otherwise. */
  async lock(stationId: string, input: LockInput): Promise<void> {
    const userId = this.seatOccupant.get(stationId) ?? (await this.prisma.station.findUnique({ where: { id: stationId }, select: { currentUserId: true } }))?.currentUserId ?? null;
    const entry: LockEntry = { ...input, id: randomUUID(), lockedAt: Date.now() };

    if (userId) {
      this.seatOccupant.set(stationId, userId);
      this.byUser.set(userId, entry);
      this.byStation.delete(stationId);
      await this.prisma.$transaction([
        this.prisma.lockGrant.deleteMany({ where: { stationId } }),
        this.prisma.lockGrant.upsert({
          where: { userId },
          create: { id: entry.id, userId, mode: entry.mode, screen: entry.screen, input: entry.input, message: entry.message, lockedById: entry.lockedBy },
          update: { id: entry.id, mode: entry.mode, screen: entry.screen, input: entry.input, message: entry.message, lockedById: entry.lockedBy, lockedAt: new Date(entry.lockedAt) },
        }),
      ]);
    } else {
      this.byStation.set(stationId, entry);
      await this.prisma.lockGrant.upsert({
        where: { stationId },
        create: { id: entry.id, stationId, mode: entry.mode, screen: entry.screen, input: entry.input, message: entry.message, lockedById: entry.lockedBy },
        update: { id: entry.id, mode: entry.mode, screen: entry.screen, input: entry.input, message: entry.message, lockedById: entry.lockedBy, lockedAt: new Date(entry.lockedAt) },
      });
    }
  }

  /** Clears both the station's own grant and its seated student's grant —
   * a teacher clicking Unlock on a seat expects the student released,
   * not just re-locked the instant they change seats. */
  async unlock(stationId: string): Promise<void> {
    this.byStation.delete(stationId);
    const userId = this.seatOccupant.get(stationId);
    const deletes = [this.prisma.lockGrant.deleteMany({ where: { stationId } })];
    if (userId) {
      this.byUser.delete(userId);
      deletes.push(this.prisma.lockGrant.deleteMany({ where: { userId } }));
    }
    await this.prisma.$transaction(deletes);
  }

  async unlockUser(userId: string): Promise<void> {
    this.byUser.delete(userId);
    await this.prisma.lockGrant.deleteMany({ where: { userId } });
  }

  /** Clears only a STATION-scoped grant (an idle-PC lock) — never touches
   * any student's own grant. Used when a student leaves a seat: the empty
   * seat must not stay locked by a stale station grant, but the departing
   * student's own lock (if any) has to survive to follow them elsewhere. */
  async clearStationGrant(stationId: string): Promise<void> {
    this.byStation.delete(stationId);
    await this.prisma.lockGrant.deleteMany({ where: { stationId } });
  }

  /** Who currently sits at `stationId`, if anyone — used by
   * ControlController to log which student(s) a lock/unlock actually
   * affected, alongside the stationIds it already logs. */
  getSeatOccupant(stationId: string): string | null {
    return this.seatOccupant.get(stationId) ?? null;
  }

  /** Station grant first — an explicit "lock this PC" beats an inherited
   * student lock — else the grant of whoever currently occupies the seat. */
  get(stationId: string): LockEntry | null {
    const stationLock = this.byStation.get(stationId);
    if (stationLock) return stationLock;
    const userId = this.seatOccupant.get(stationId);
    if (userId) return this.byUser.get(userId) ?? null;
    return null;
  }

  /** Union of every station with its own grant, plus, for each locked
   * user, whatever station they currently occupy. This drives
   * ControlGateway.pushLockHeartbeats — it MUST resolve through
   * seatOccupant or an inherited lock is never renewed and silently
   * self-releases after 30s even though nobody clicked Unlock. */
  listLockedStationIds(): string[] {
    const ids = new Set(this.byStation.keys());
    for (const [stationId, userId] of this.seatOccupant) {
      if (this.byUser.has(userId)) ids.add(stationId);
    }
    return Array.from(ids);
  }

  /** Called right after a classroom sign-in/sign-out changes who sits
   * where (ClassroomService.signIn/releaseAndNotify) — this is precisely
   * what makes a student's lock "follow" them to a new seat. Returns
   * whether the EFFECTIVE lock for `stationId` changed as a result, so a
   * caller can decide whether a fresh snapshot/status push is warranted. */
  setSeatOccupant(stationId: string, userId: string | null): boolean {
    const before = this.get(stationId);
    if (userId) this.seatOccupant.set(stationId, userId);
    else this.seatOccupant.delete(stationId);
    const after = this.get(stationId);
    return before?.id !== after?.id;
  }
}
