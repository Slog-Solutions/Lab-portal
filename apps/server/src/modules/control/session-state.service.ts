import { Injectable } from '@nestjs/common';
import { emptyDesiredState, type ActivityType, type DesiredStationState } from '@lab/shared';
import { BROADCAST_ROOM, groupMediaRoom } from '@lab/shared/events';
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

    const groupRoomName = groupMediaRoom(member.group.sessionId, member.groupId);
    const groupToken = await this.media.mintToken({
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
            config: member.group.activity.config,
          }
        : null,
      lock: lock ? { ...lock, expiresAt: Date.now() + LOCK_HEARTBEAT_TTL_MS } : null,
      media: {
        rooms: [
          { room: BROADCAST_ROOM, token: broadcastToken, publish: { mic: true, screen: isTeacher } },
          { room: groupRoomName, token: groupToken, publish: { mic: true, screen: false } },
        ],
      },
      stationEnabled: true,
      monitoringIndicator: true,
    };
  }
}
