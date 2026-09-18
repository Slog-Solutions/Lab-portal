import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, SessionRole, SessionState, UserRole, type CreateSessionDto } from '@lab/shared';
import { mediaRoomForActivity } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { SessionStateService } from '../control/session-state.service';
import { ControlGateway } from '../control/control.gateway';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { BatchAccessService } from '../batches/batch-access.service';
import { BatchesService } from '../batches/batches.service';
import { ClassAccessService } from '../classroom/class-access.service';

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
    private readonly batchAccess: BatchAccessService,
    private readonly batches: BatchesService,
    private readonly classAccess: ClassAccessService,
  ) {}

  async create(dto: CreateSessionDto, user: JwtPayload) {
    await this.batchAccess.assertCanUseBatch(user, dto.batchId);
    const teacherId = user.sub;
    const indices = new Set(dto.groups.map((g) => g.index));
    if (indices.size !== dto.groups.length) {
      throw new BadRequestException('Group indices must be unique within a session (max 6)');
    }
    if (user.role === UserRole.TEACHER) {
      // Same "only my class" boundary ControlController/CommandsService
      // enforce for live control (design decision: "a teacher sees and
      // controls only the PCs in their active class") — a session built
      // from a station outside the teacher's class would otherwise let
      // them arm/start/monitor a group they have no other control over.
      const allStationIds = dto.groups.flatMap((g) => g.memberStationIds);
      const controllable = await this.classAccess.filterControllable(user, allStationIds);
      if (controllable.length !== allStationIds.length) {
        throw new ForbiddenException('Some selected computers are not in your class');
      }
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
            members: {
              // chairmanStationId was previously ignored here — every
              // member was hardcoded MEMBER, so Ser 3's chairman-led
              // round table could never actually have a chairman.
              // Phase 5: CONFERENCE_INTERPRETING's config.roles[] carries
              // the same kind of per-station role assignment (interpreter
              // vs delegate vs observer) — mirrored into SessionMember.role
              // here for the same reason chairman is: it's what
              // SessionStateService actually reads to decide LiveKit
              // publish grants, so it must be real DB state, not just
              // something the client re-derives from activity.config.
              create: g.memberStationIds.map((stationId) => ({
                stationId,
                role: this.resolveMemberRole(g, stationId),
              })),
            },
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

  /** ADMIN sees every session; TEACHER only sessions in a batch they're
   * assigned to (enforcement — see BatchAccessService). */
  async list(user: JwtPayload) {
    const where =
      user.role === UserRole.ADMIN ? {} : { batchId: { in: await this.batchAccess.batchIdsForTeacher(user.sub) } };
    return this.prisma.classSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { groups: { select: { id: true, index: true } } },
    });
  }

  /** Delegates to BatchesService.listForPrincipal — the same authority
   * GET /batches/mine reads from, so "which batches may this teacher
   * use" has exactly one implementation. */
  async listBatches(user: JwtPayload) {
    return this.batches.listForPrincipal(user);
  }

  /**
   * DRAFT -> ARMED: freezes groups, creates per-group LiveKit rooms,
   * pushes a fresh snapshot (with media tokens) to every member station.
   * Idempotent room creation (MediaService.ensureRoom).
   */
  async arm(sessionId: string, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
    if (session.state !== SessionState.DRAFT) {
      throw new BadRequestException(`Cannot arm a session in state ${session.state}`);
    }

    await this.media.ensureBroadcastRoom();
    for (const group of session.groups) {
      await this.media.ensureRoom(mediaRoomForActivity(sessionId, group.id, group.activity?.type ?? ''));
    }

    const updated = await this.bumpAndPersist(sessionId, SessionState.ARMED);
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId: user.sub, action: 'session.arm', detail: { sessionId } });
    return updated;
  }

  async start(sessionId: string, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
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
    await this.audit.log({ actorId: user.sub, action: 'session.start', detail: { sessionId } });
    return updated;
  }

  async pause(sessionId: string, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
    if (session.state !== SessionState.RUNNING) {
      throw new BadRequestException(`Cannot pause a session in state ${session.state}`);
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.PAUSED);
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId: user.sub, action: 'session.pause', detail: { sessionId } });
    return updated;
  }

  async end(sessionId: string, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
    if (session.state === SessionState.ENDED) return session;

    for (const group of session.groups) {
      await this.media.deleteRoom(mediaRoomForActivity(sessionId, group.id, group.activity?.type ?? ''));
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.ENDED, { endedAt: new Date() });
    // Push a fresh (now empty-for-this-session) snapshot so stations
    // fall back to idle/broadcast-only immediately rather than waiting
    // for the 4h token TTL or a reconnect.
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId: user.sub, action: 'session.end', detail: { sessionId } });
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

  /** CONFERENCE_INTERPRETING's config.roles[] assigns INTERPRETER/DELEGATE/
   * OBSERVER per station — everyone else falls back to the pre-existing
   * chairman-or-member logic. Kept as one small helper rather than inline
   * in the create() mapper so the "which config shape maps to which role"
   * decision has one home as more activity types grow their own roles. */
  private resolveMemberRole(g: CreateSessionDto['groups'][number], stationId: string): SessionRole {
    if (g.activityType === ActivityType.CONFERENCE_INTERPRETING) {
      const roles = (g.activityConfig as { roles?: Array<{ stationId: string; role: string }> } | undefined)?.roles ?? [];
      const assigned = roles.find((r) => r.stationId === stationId)?.role;
      if (assigned === 'INTERPRETER') return SessionRole.INTERPRETER;
      if (assigned === 'DELEGATE') return SessionRole.DELEGATE;
      if (assigned === 'OBSERVER') return SessionRole.OBSERVER;
      return SessionRole.MEMBER;
    }
    return stationId === g.chairmanStationId ? SessionRole.CHAIRMAN : SessionRole.MEMBER;
  }
}
