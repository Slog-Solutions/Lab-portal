import { Injectable } from '@nestjs/common';
import {
  ActivityType,
  SessionRole,
  emptyDesiredState,
  seatLabel,
  type DesiredStationState,
  type RoundTableView,
} from '@lab/shared';
import { BROADCAST_ROOM, classBroadcastRoom, mediaRoomForActivity } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { LockService } from './lock.service';
import { RoundTableFloorStore } from './round-table-floor.store';

const LOCK_HEARTBEAT_TTL_MS = 30_000; // design doc §3.3 — 30s without renewal auto-unlocks

/**
 * Computes the authoritative DesiredStationState for one station
 * (design doc §4.3, §4.5). This single code path serves first join,
 * reconnect, and post-restart resync — the station always asks "what
 * should I be doing right now?" and gets one coherent answer.
 *
 * Every enabled station gets a `lab:broadcast` grant regardless of
 * session state (design doc's two-plane model, Plane A: "all 41
 * stations permanently joined") — the teacher can broadcast/intercom the
 * whole class at any time, not only during a formal session. Seat 1 is
 * the teacher seat (see Station's schema comment) and is the only
 * identity granted publish rights on that room.
 */
@Injectable()
export class SessionStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly locks: LockService,
    private readonly roundTableFloors: RoundTableFloorStore,
  ) {}

  async getDesiredState(stationId: string): Promise<DesiredStationState> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      include: { liveClass: { include: { teacher: { select: { fullName: true } } } } },
    });
    if (!station || !station.enabled) {
      return { ...emptyDesiredState(0), stationEnabled: !!station?.enabled };
    }

    const liveClass = station.liveClass
      ? { id: station.liveClass.id, title: station.liveClass.title, teacherName: station.liveClass.teacher.fullName }
      : null;

    const isTeacher = station.seatNo === 1;
    // The LiveKit-participant-visible name (design doc §2.2) — matches the
    // seat-label convention ControlGateway.emitIdentity already uses
    // ("System <n>"), not the raw hostname, since this is what a spotlight
    // viewer (ScreenSpotlightPanel / StudentConsole's presenter label)
    // shows for whoever is presenting. Falls back to hostname for a
    // station that hasn't been assigned a seat yet.
    const displayName = station.seatNo !== null ? `System ${seatLabel(station.seatNo)}` : station.hostname;
    await this.media.ensureBroadcastRoom();
    const broadcastToken = await this.media.mintToken({
      stationId,
      displayName,
      room: BROADCAST_ROOM,
      role: isTeacher ? 'TEACHER' : 'STUDENT',
    });
    // A station currently signed into a class also gets that class's own
    // scoped broadcast room, alongside the lab-wide one — see
    // MediaController.broadcastToken (TEACHER mints into this room, not
    // BROADCAST_ROOM). ClassroomService.start ensures the room once, at
    // class creation, but that's a single unretried attempt (network
    // blip, LiveKit hiccup) — unlike BROADCAST_ROOM above, which
    // self-heals via ensureBroadcastRoom() on every snapshot. Re-ensuring
    // here too (LiveKit's createRoom is idempotent — see ensureRoom's doc
    // comment) means a station can never get stuck minting tokens for a
    // room that silently never got created.
    const classRoomGrant = station.liveClass
      ? await (async () => {
          const room = classBroadcastRoom(station.liveClass!.id);
          await this.media.ensureRoom(room);
          return {
            room,
            token: await this.media.mintToken({ stationId, displayName, room, role: 'STUDENT' as const }),
            publish: { mic: true, screen: false },
          };
        })()
      : null;

    const member = await this.prisma.sessionMember.findFirst({
      where: { stationId, group: { session: { state: { in: ['ARMED', 'RUNNING', 'PAUSED'] } } } },
      include: { group: { include: { session: true, activity: true } } },
    });

    if (!member) {
      // Read right here, after the last await in this branch — a
      // concurrent lock/unlock racing this call must not be re-sent (or
      // dropped) because we captured it too early.
      const lock = this.locks.get(stationId);
      return {
        seq: 0,
        sessionId: null,
        groupId: null,
        role: null,
        activity: null,
        lock: lock ? { id: lock.id, mode: lock.mode, screen: lock.screen, input: lock.input, message: lock.message, expiresAt: Date.now() + LOCK_HEARTBEAT_TTL_MS } : null,
        media: {
          rooms: [
            { room: BROADCAST_ROOM, token: broadcastToken, publish: { mic: true, screen: isTeacher } },
            ...(classRoomGrant ? [classRoomGrant] : []),
          ],
        },
        stationEnabled: true,
        monitoringIndicator: true,
        liveClass,
      };
    }

    const activityType = member.group.activity?.type as ActivityType | undefined;
    const groupRoomName = mediaRoomForActivity(member.group.sessionId, member.groupId, activityType ?? '');
    // Ser 8 Conference Interpreting (Phase 5): the shared interpreting
    // room needs per-role publish grants (interpreter/delegate publish
    // their own channel, observer is subscribe-only) — every other
    // activity keeps the generic mic-for-everyone group grant.
    // Ser 3 Round Table: the SERVER owns the floor. Every member's token
    // starts with canPublish:false — including the chairman's — and the
    // floor service grants the right in place (RoundTableService), so a
    // reconnect with a fresh token can never briefly hand a member an open mic.
    const roundTable = activityType === ActivityType.ROUND_TABLE ? await this.roundTableView(member.groupId, stationId) : null;
    const groupToken = roundTable
      ? await this.media.mintMicGatedToken({
          stationId,
          displayName,
          room: groupRoomName,
          canPublishMic: false,
          role: isTeacher ? 'TEACHER' : 'STUDENT',
        })
      : activityType === ActivityType.CONFERENCE_INTERPRETING
        ? await this.media.mintInterpretingToken({
            stationId,
            displayName,
            room: groupRoomName,
            canPublishMic: isTeacher || member.role === SessionRole.INTERPRETER || member.role === SessionRole.DELEGATE,
          })
        : await this.media.mintToken({
            stationId,
            displayName,
            room: groupRoomName,
            role: isTeacher ? 'TEACHER' : 'STUDENT',
          });

    // Read right here, after the last await above (groupToken) — same
    // reasoning as the no-member branch.
    const lock = this.locks.get(stationId);
    return {
      seq: member.group.session.seq,
      sessionId: member.group.sessionId,
      groupId: member.groupId,
      role: member.role as DesiredStationState['role'],
      activity: member.group.activity
        ? {
            type: member.group.activity.type as ActivityType,
            instanceId: member.group.activity.id,
            config: this.sanitizeConfigForWire(member.group.activity.type as ActivityType, member.group.activity.config),
          }
        : null,
      lock: lock ? { id: lock.id, mode: lock.mode, screen: lock.screen, input: lock.input, message: lock.message, expiresAt: Date.now() + LOCK_HEARTBEAT_TTL_MS } : null,
      media: {
        rooms: [
          { room: BROADCAST_ROOM, token: broadcastToken, publish: { mic: true, screen: isTeacher } },
          ...(classRoomGrant ? [classRoomGrant] : []),
          {
            room: groupRoomName,
            token: groupToken,
            publish: {
              mic: roundTable
                ? roundTable.micAllowed
                : activityType === ActivityType.CONFERENCE_INTERPRETING
                  ? member.role !== SessionRole.OBSERVER
                  : true,
              screen: false,
            },
          },
        ],
      },
      stationEnabled: true,
      monitoringIndicator: true,
      liveClass,
      ...(roundTable ? { roundTable: roundTable.view } : {}),
    };
  }

  /** Floor + roster for a Round Table station's snapshot (see
   * RoundTableFloorStore). Null when the group has no live floor. */
  private async roundTableView(
    groupId: string,
    stationId: string,
  ): Promise<{ view: RoundTableView; micAllowed: boolean } | null> {
    const group = await this.roundTableFloors.ensure(groupId);
    if (!group) return null;
    const rows = await this.prisma.sessionMember.findMany({
      where: { groupId },
      include: { station: { select: { seatNo: true, currentUser: { select: { fullName: true } } } } },
    });
    const members = rows
      .map((m) => ({
        stationId: m.stationId,
        seatNo: m.station.seatNo,
        studentName: m.station.currentUser?.fullName ?? null,
      }))
      .sort((a, b) => (a.seatNo ?? 1e9) - (b.seatNo ?? 1e9));
    const f = group.floor;
    return {
      view: { topic: group.config.topic, floor: { ...f, queue: [...f.queue] }, members },
      micAllowed: f.phase === 'RUNNING' && (stationId === f.chairmanStationId || stationId === f.speakerStationId),
    };
  }

  /**
   * Phase 3 finding: ActivityInstance.config was forwarded to the
   * student's own snapshot unmodified. That was harmless while nothing
   * consumed VOCABULARY_TEST's inline-items config shape (dead code, per
   * the Phase 3 recon), but the moment a real player exists, an inline
   * vocabulary item's `answer` field would be sitting in plain sight in
   * the student's own DesiredStationState — the exact question it's
   * about to be tested on. Strip answer keys here, at the one choke point
   * every live-session activity config passes through, rather than
   * trusting every future player to remember not to render `config.answer`.
   */
  private sanitizeConfigForWire(type: ActivityType, config: unknown): unknown {
    if (type === ActivityType.VOCABULARY_TEST && config && typeof config === 'object' && !Array.isArray(config)) {
      const cfg = config as { items?: unknown };
      if (Array.isArray(cfg.items)) {
        return {
          ...cfg,
          items: cfg.items.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const { answer: _answer, ...rest } = item as { answer?: unknown };
            return rest;
          }),
        };
      }
    }
    return config;
  }
}
