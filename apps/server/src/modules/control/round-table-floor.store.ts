import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActivityType, SessionRole, SessionState, type RoundTableFloor } from '@lab/shared';
import { zRoundTableConfig, type RoundTableConfig } from '@lab/shared/activities';
import { PrismaService } from '../../prisma/prisma.service';

export interface RoundTableGroupMember {
  stationId: string;
  seatNo: number | null;
}

/** Everything the server keeps in memory for one live Round Table group. */
export interface RoundTableGroupState {
  groupId: string;
  sessionId: string;
  instanceId: string;
  config: RoundTableConfig;
  floor: RoundTableFloor;
  /** Ordered by seat number (nulls last) — the order chairman rotation and
   * automatic promotion walk. Membership is frozen at arm. */
  members: RoundTableGroupMember[];
  /** Activity start (epoch ms); turn times are relative to it. */
  startedAtMs: number | null;
}

const LIVE_STATES: string[] = [SessionState.ARMED, SessionState.RUNNING, SessionState.PAUSED];

function phaseOf(state: string): RoundTableFloor['phase'] {
  return state === SessionState.RUNNING ? 'RUNNING' : state === SessionState.PAUSED ? 'PAUSED' : 'ARMED';
}

/**
 * In-memory Round Table floors (one per live group) with intent persisted
 * to `ActivityInstance.state` and reloaded on boot — the same shape as
 * LockService (in-memory hot path, Postgres for restart survival). It lives
 * in the control module, Prisma-only, so SessionStateService can read the
 * floor into the desired-state snapshot without a module cycle: a station
 * that reconnects mid-discussion then renders the right speaker, queue and
 * mic state straight from its snapshot, with no special recovery code.
 */
@Injectable()
export class RoundTableFloorStore implements OnModuleInit {
  private readonly logger = new Logger(RoundTableFloorStore.name);
  private readonly groups = new Map<string, RoundTableGroupState>();
  private readonly loading = new Map<string, Promise<RoundTableGroupState | null>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const live = await this.prisma.activityInstance.findMany({
        where: { type: ActivityType.ROUND_TABLE, group: { session: { state: { in: LIVE_STATES as never[] } } } },
        select: { groupId: true },
      });
      for (const { groupId } of live) await this.ensure(groupId);
      if (live.length > 0) this.logger.log(`Rehydrated ${live.length} Round Table floor(s) from Postgres`);
    } catch (err) {
      this.logger.error('Could not rehydrate Round Table floors', err as Error);
    }
  }

  get(groupId: string): RoundTableGroupState | undefined {
    return this.groups.get(groupId);
  }

  all(): RoundTableGroupState[] {
    return Array.from(this.groups.values());
  }

  drop(groupId: string): void {
    this.groups.delete(groupId);
  }

  /** The live floor for `groupId`, built from the DB on first use. Null when
   * the group is not a ROUND_TABLE group of a live (ARMED/RUNNING/PAUSED)
   * session. */
  ensure(groupId: string): Promise<RoundTableGroupState | null> {
    const cached = this.groups.get(groupId);
    if (cached) return Promise.resolve(cached);
    const inflight = this.loading.get(groupId);
    if (inflight) return inflight;
    const p = this.build(groupId).finally(() => this.loading.delete(groupId));
    this.loading.set(groupId, p);
    return p;
  }

  /** Re-reads what a session state change can alter (phase, activity start,
   * roster) without discarding the floor itself. */
  async refresh(groupId: string): Promise<RoundTableGroupState | null> {
    const existing = this.groups.get(groupId);
    if (!existing) return this.ensure(groupId);
    const row = await this.load(groupId);
    if (!row || !row.activity) return existing;
    existing.floor.phase = phaseOf(row.session.state);
    existing.startedAtMs = row.activity.startedAt?.getTime() ?? null;
    existing.members = this.orderedMembers(row.members);
    return existing;
  }

  /** Fire-and-forget: a failed write costs restart-survival of one change,
   * never the live floor. */
  persist(state: RoundTableGroupState): void {
    const { speakerStationId, queue, seq, turnStartedAt, chairmanStationId } = state.floor;
    void this.prisma.activityInstance
      .update({
        where: { id: state.instanceId },
        data: { state: { roundTable: { speakerStationId, queue, seq, turnStartedAt, chairmanStationId } } },
      })
      .catch((err: Error) => this.logger.warn(`persist floor ${state.groupId} failed: ${err.message}`));
  }

  private load(groupId: string) {
    return this.prisma.sessionGroup.findUnique({
      where: { id: groupId },
      include: { session: true, activity: true, members: { include: { station: { select: { seatNo: true } } } } },
    });
  }

  private orderedMembers(
    members: Array<{ stationId: string; station: { seatNo: number | null } }>,
  ): RoundTableGroupMember[] {
    return members
      .map((m) => ({ stationId: m.stationId, seatNo: m.station.seatNo }))
      .sort((a, b) => (a.seatNo ?? 1e9) - (b.seatNo ?? 1e9));
  }

  private async build(groupId: string): Promise<RoundTableGroupState | null> {
    const row = await this.load(groupId);
    if (!row?.activity || row.activity.type !== ActivityType.ROUND_TABLE) return null;
    if (!LIVE_STATES.includes(row.session.state)) return null;

    const parsed = zRoundTableConfig.safeParse(row.activity.config);
    const config = parsed.success ? parsed.data : zRoundTableConfig.parse({ topic: 'Discussion' });
    const members = this.orderedMembers(row.members);
    const chairman = row.members.find((m) => m.role === SessionRole.CHAIRMAN)?.stationId ?? members[0]?.stationId;
    if (!chairman) return null;

    const saved = ((row.activity.state ?? {}) as { roundTable?: Partial<RoundTableFloor> }).roundTable ?? {};
    const memberIds = new Set(members.map((m) => m.stationId));
    const speaker = saved.speakerStationId && memberIds.has(saved.speakerStationId) ? saved.speakerStationId : null;
    const state: RoundTableGroupState = {
      groupId,
      sessionId: row.sessionId,
      instanceId: row.activity.id,
      config,
      members,
      startedAtMs: row.activity.startedAt?.getTime() ?? null,
      floor: {
        groupId,
        chairmanStationId: chairman,
        speakerStationId: speaker,
        queue: Array.isArray(saved.queue) ? saved.queue.filter((id) => memberIds.has(id) && id !== chairman) : [],
        // Teacher presence is never restored: the teacher's own connection
        // is gone with the old process. The reconcile loop would clear it anyway.
        teacher: 'absent',
        turnStartedAt: speaker ? (saved.turnStartedAt ?? Date.now()) : null,
        seq: saved.seq ?? 0,
        phase: phaseOf(row.session.state),
        chairmanOffline: false,
      },
    };
    this.groups.set(groupId, state);
    return state;
  }
}
