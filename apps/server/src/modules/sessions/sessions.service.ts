import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionState, type CreateSessionDto } from '@lab/shared';
import { groupMediaRoom } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { SessionStateService } from '../control/session-state.service';
import { ControlGateway } from '../control/control.gateway';
import { AuditService } from '../audit/audit.service';

/**
 * Session/group CRUD + the server-authoritative state machine (design
 * doc §4.5): DRAFT -> ARMED -> RUNNING <-> PAUSED -> ENDED. Up to 6
 * groups per session, each running one activity, all concurrent and
 * independent (Annexure-I Ser 1).
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly sessionState: SessionStateService,
    private readonly gateway: ControlGateway,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSessionDto, teacherId: string) {
    const indices = new Set(dto.groups.map((g) => g.index));
    if (indices.size !== dto.groups.length) {
      throw new BadRequestException('Group indices must be unique within a session (max 6)');
    }

    return this.prisma.classSession.create({
      data: {
        title: dto.title,
        batchId: dto.batchId,
        teacherId,
        state: SessionState.DRAFT,
        groups: {
          create: dto.groups.map((g) => ({
            index: g.index,
            members: { create: g.memberStationIds.map((stationId) => ({ stationId, role: 'MEMBER' })) },
            activity: { create: { type: g.activityType, config: g.activityConfig as object } },
          })),
        },
      },
      include: { groups: { include: { members: true, activity: true } } },
    });
  }

  async get(sessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: { groups: { include: { members: { include: { station: true } }, activity: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async list() {
    return this.prisma.classSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: { groups: { select: { id: true, index: true } } },
    });
  }

  /**
   * DRAFT -> ARMED: freezes groups, creates per-group LiveKit rooms,
   * pushes a fresh snapshot (with media tokens) to every member station.
   * Idempotent room creation (MediaService.ensureRoom).
   */
  async arm(sessionId: string, actorId: string) {
    const session = await this.get(sessionId);
    if (session.state !== SessionState.DRAFT) {
      throw new BadRequestException(`Cannot arm a session in state ${session.state}`);
    }

    await this.media.ensureBroadcastRoom();
    for (const group of session.groups) {
      await this.media.ensureRoom(groupMediaRoom(sessionId, group.id));
    }

    const updated = await this.bumpAndPersist(sessionId, SessionState.ARMED);
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId, action: 'session.arm', detail: { sessionId } });
    return updated;
  }

  async start(sessionId: string, actorId: string) {
    const session = await this.get(sessionId);
    if (session.state !== SessionState.ARMED && session.state !== SessionState.PAUSED) {
      throw new BadRequestException(`Cannot start a session in state ${session.state}`);
    }
    if (session.state === SessionState.ARMED) {
      await this.prisma.activityInstance.updateMany({
        where: { group: { sessionId } },
        data: { startedAt: new Date() },
      });
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.RUNNING, { startedAt: new Date() });
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId, action: 'session.start', detail: { sessionId } });
    return updated;
  }

  async pause(sessionId: string, actorId: string) {
    const session = await this.get(sessionId);
    if (session.state !== SessionState.RUNNING) {
      throw new BadRequestException(`Cannot pause a session in state ${session.state}`);
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.PAUSED);
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId, action: 'session.pause', detail: { sessionId } });
    return updated;
  }

  async end(sessionId: string, actorId: string) {
    const session = await this.get(sessionId);
    if (session.state === SessionState.ENDED) return session;

    for (const group of session.groups) {
      await this.media.deleteRoom(groupMediaRoom(sessionId, group.id));
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.ENDED, { endedAt: new Date() });
    // Push a fresh (now empty-for-this-session) snapshot so stations
    // fall back to idle/broadcast-only immediately rather than waiting
    // for the 4h token TTL or a reconnect.
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId, action: 'session.end', detail: { sessionId } });
    return updated;
  }

  private async bumpAndPersist(
    sessionId: string,
    state: (typeof SessionState)[keyof typeof SessionState],
    extra: Record<string, unknown> = {},
  ) {
    return this.prisma.classSession.update({
      where: { id: sessionId },
      data: { state, seq: { increment: 1 }, ...extra },
    });
  }

  private async pushToAllMembers(stationIds: string[]): Promise<void> {
    for (const stationId of stationIds) {
      const snapshot = await this.sessionState.getDesiredState(stationId);
      this.gateway.pushSnapshot(stationId, snapshot);
    }
  }
}
