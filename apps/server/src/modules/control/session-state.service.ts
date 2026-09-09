import { Injectable } from '@nestjs/common';
import { ActivityType, SessionRole, emptyDesiredState, type DesiredStationState } from '@lab/shared';
import { BROADCAST_ROOM, mediaRoomForActivity } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { LockService } from './lock.service';

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
  ) {}

  async getDesiredState(stationId: string): Promise<DesiredStationState> {
    const station = await this.prisma.station.findUnique({ where: { id: stationId } });
    if (!station || !station.enabled) {
      return { ...emptyDesiredState(0), stationEnabled: !!station?.enabled };
    }

    const isTeacher = station.seatNo === 1;
    await this.media.ensureBroadcastRoom();
    const broadcastToken = await this.media.mintToken({
      stationId,
      displayName: station.hostname,
      room: BROADCAST_ROOM,
      role: isTeacher ? 'TEACHER' : 'STUDENT',
    });

    const member = await this.prisma.sessionMember.findFirst({
      where: { stationId, group: { session: { state: { in: ['ARMED', 'RUNNING', 'PAUSED'] } } } },
      include: { group: { include: { session: true, activity: true } } },
    });

    const lock = this.locks.get(stationId);

    if (!member) {
      return {
        seq: 0,
        sessionId: null,
        groupId: null,
        role: null,
        activity: null,
        lock: lock ? { ...lock, expiresAt: Date.now() + LOCK_HEARTBEAT_TTL_MS } : null,
        media: { rooms: [{ room: BROADCAST_ROOM, token: broadcastToken, publish: { mic: true, screen: isTeacher } }] },
        stationEnabled: true,
        monitoringIndicator: true,
      };
    }

    const activityType = member.group.activity?.type as ActivityType | undefined;
    const groupRoomName = mediaRoomForActivity(member.group.sessionId, member.groupId, activityType ?? '');
    // Ser 8 Conference Interpreting (Phase 5): the shared interpreting
    // room needs per-role publish grants (interpreter/delegate publish
    // their own channel, observer is subscribe-only) — every other
    // activity keeps the generic mic-for-everyone group grant.
    const groupToken =
      activityType === ActivityType.CONFERENCE_INTERPRETING
        ? await this.media.mintInterpretingToken({
            stationId,
            displayName: station.hostname,
            room: groupRoomName,
            canPublishMic: isTeacher || member.role === SessionRole.INTERPRETER || member.role === SessionRole.DELEGATE,
          })
        : await this.media.mintToken({
            stationId,
            displayName: station.hostname,
            room: groupRoomName,
            role: isTeacher ? 'TEACHER' : 'STUDENT',
          });

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
      lock: lock ? { ...lock, expiresAt: Date.now() + LOCK_HEARTBEAT_TTL_MS } : null,
      media: {
        rooms: [
          { room: BROADCAST_ROOM, token: broadcastToken, publish: { mic: true, screen: isTeacher } },
          {
            room: groupRoomName,
            token: groupToken,
            publish: {
              mic: activityType === ActivityType.CONFERENCE_INTERPRETING ? member.role !== SessionRole.OBSERVER : true,
              screen: false,
            },
          },
        ],
      },
      stationEnabled: true,
      monitoringIndicator: true,
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
