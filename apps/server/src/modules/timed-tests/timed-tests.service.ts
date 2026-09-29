import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, AttemptStatus, UserRole, seatLabel, type CreateSessionDto, type LaunchTestDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BatchAccessService } from '../batches/batch-access.service';
import { SessionsService } from '../sessions/sessions.service';
import { ControlGateway } from '../control/control.gateway';
import type { JwtPayload } from '../auth/auth.service';
import { TestCloseService } from './test-close.service';

type BoardRowStatus = 'NOT_STARTED' | 'ANSWERING' | 'SUBMITTED';

export interface TestBoardRow {
  stationId: string;
  seatNo: number | null;
  studentName: string | null;
  status: BoardRowStatus;
  answered: number;
  total: number;
  /** Teacher/admin view only (§6.4 "always full detail") — set once the
   * attempt is SCORED, independent of whether the instance itself has
   * revealed to the students yet. */
  rawScore: number | null;
  maxScore: number | null;
}

/**
 * SPEC-mcq-test-timed-reveal.md §6.1/§6.5 — "Launch in lab" and the
 * teacher's live overrides (Reveal now / Extend / Close without reveal /
 * Release). Every write here is scoped to the caller's own class via
 * BatchAccessService.assertCanUseBatch, same authority every other
 * session-scoped teacher action in this codebase already uses.
 */
@Injectable()
export class TimedTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
    private readonly sessions: SessionsService,
    private readonly gateway: ControlGateway,
    private readonly testClose: TestCloseService,
  ) {}

  /** One call: create a one-group live session over the picked seats,
   * linked to the saved Exercise, armed and started immediately — the
   * dialog appears on every seat and the timer (if any) starts now. */
  async launch(user: JwtPayload, dto: LaunchTestDto) {
    const exercise = await this.prisma.exercise.findUnique({ where: { id: dto.exerciseId } });
    if (!exercise) throw new NotFoundException('Exercise not found');
    if (exercise.type !== ActivityType.VOCABULARY_TEST) {
      throw new BadRequestException('Only vocabulary tests can be launched in the lab');
    }
    if (user.role !== UserRole.ADMIN && exercise.teacherId !== user.sub) {
      throw new ForbiddenException('Only the authoring teacher or an admin may launch this test');
    }

    const stationIds = Object.keys(dto.expectedStudents);
    // Nothing stops a seat from already being in another live
    // ARMED/RUNNING/PAUSED session — SessionsService.create has never
    // checked this (any generic Session Builder launch has the same
    // gap), but a launched test's own single-group session makes it
    // cheap and worthwhile to check here, before committing to a
    // partially-usable class run.
    const busy = await this.prisma.sessionMember.findMany({
      where: { stationId: { in: stationIds }, group: { session: { state: { in: ['ARMED', 'RUNNING', 'PAUSED'] } } } },
      select: { station: { select: { seatNo: true } } },
    });
    if (busy.length > 0) {
      const seats = busy.map((b) => `System ${seatLabel(b.station.seatNo)}`).join(', ');
      throw new ConflictException(`Already in another live activity: ${seats}`);
    }

    const createDto: CreateSessionDto = {
      title: exercise.title.slice(0, 120),
      batchId: dto.batchId,
      groups: [
        {
          index: 1,
          activityType: ActivityType.VOCABULARY_TEST,
          activityConfig: exercise.config,
          memberStationIds: stationIds,
          dictionaryEnabled: exercise.dictionaryEnabled ?? undefined,
        },
      ],
      expectedStudents: dto.expectedStudents,
    };
    const created = await this.sessions.create(createDto, user, { exerciseIdByGroupIndex: { 1: exercise.id } });
    await this.sessions.arm(created.id, user);
    await this.sessions.start(created.id, user);
    const armed = await this.sessions.get(created.id);
    const instanceId = armed.groups[0]?.activity?.id ?? null;

    await this.audit.log({ actorId: user.sub, action: 'test.launch', detail: { exerciseId: exercise.id, sessionId: created.id, instanceId, seats: stationIds.length } });
    return { sessionId: created.id, activityInstanceId: instanceId };
  }

  async board(user: JwtPayload, instanceId: string): Promise<{
    activityInstanceId: string;
    title: string;
    status: 'READY' | 'OPEN' | 'CLOSED';
    revealed: boolean;
    closesAt: number | null;
    serverNow: number;
    rows: TestBoardRow[];
  }> {
    const instance = await this.loadInstanceWithAccess(user, instanceId);

    const [members, attempts] = await Promise.all([
      this.prisma.sessionMember.findMany({
        where: { groupId: instance.groupId },
        include: { station: { select: { seatNo: true } }, student: { select: { fullName: true } } },
      }),
      this.prisma.attempt.findMany({
        where: { activityInstanceId: instanceId },
        select: { studentId: true, status: true, answers: true, itemOrder: true, rawScore: true, maxScore: true },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    // Newest attempt per student wins (a resumed/retried row would
    // otherwise be counted twice) — attempts is already newest-first.
    const byStudent = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) {
      if (a.studentId && !byStudent.has(a.studentId)) byStudent.set(a.studentId, a);
    }

    const rows: TestBoardRow[] = members
      .map((m) => {
        const attempt = m.studentId ? byStudent.get(m.studentId) : undefined;
        const answered = attempt ? Object.keys((attempt.answers as Record<string, string> | null) ?? {}).length : 0;
        const status: BoardRowStatus = !attempt ? 'NOT_STARTED' : attempt.status === AttemptStatus.IN_PROGRESS ? 'ANSWERING' : 'SUBMITTED';
        return {
          stationId: m.stationId,
          seatNo: m.station.seatNo,
          studentName: m.student?.fullName ?? null,
          status,
          answered,
          total: attempt?.itemOrder.length ?? 0,
          rawScore: attempt?.status === AttemptStatus.SCORED ? attempt.rawScore : null,
          maxScore: attempt?.status === AttemptStatus.SCORED ? attempt.maxScore : null,
        };
      })
      .sort((a, b) => (a.seatNo ?? 1e9) - (b.seatNo ?? 1e9));

    return {
      activityInstanceId: instance.id,
      title: instance.exercise!.title,
      status: instance.closedAt ? 'CLOSED' : instance.group.session.state === 'ARMED' ? 'READY' : 'OPEN',
      revealed: instance.revealedAt !== null,
      closesAt: instance.closesAt ? instance.closesAt.getTime() : null,
      serverNow: Date.now(),
      rows,
    };
  }

  /** Closes the test now (if not already closed) and reveals — used both
   * for the teacher's "Reveal now" on an open test and, functionally
   * identically, to release an ON_TEACHER_RELEASE test that is already
   * closed (see TestCloseService.release). */
  async revealNow(user: JwtPayload, instanceId: string): Promise<{ ok: true }> {
    await this.loadInstanceWithAccess(user, instanceId);
    await this.testClose.finalizeInstance(instanceId, 'REVEAL_NOW');
    await this.audit.log({ actorId: user.sub, action: 'test.reveal_now', detail: { instanceId } });
    return { ok: true };
  }

  async release(user: JwtPayload, instanceId: string): Promise<{ ok: true }> {
    await this.loadInstanceWithAccess(user, instanceId);
    await this.testClose.release(instanceId);
    await this.audit.log({ actorId: user.sub, action: 'test.release', detail: { instanceId } });
    return { ok: true };
  }

  async closeWithoutReveal(user: JwtPayload, instanceId: string): Promise<{ ok: true }> {
    await this.loadInstanceWithAccess(user, instanceId);
    await this.testClose.finalizeInstance(instanceId, 'NO_REVEAL');
    await this.audit.log({ actorId: user.sub, action: 'test.close_without_reveal', detail: { instanceId } });
    return { ok: true };
  }

  /** §4.4 "Extend time — pushes closesAt later. Allowed only before reveal
   * has happened." An optimistic conditional update: `closesAt: oldClosesAt`
   * in the guard means a concurrent Extend (or the sweep closing it in the
   * same instant) makes this fail cleanly with 409 rather than silently
   * computing the new time from a value that's already stale. */
  async extend(user: JwtPayload, instanceId: string, seconds: number): Promise<{ ok: true; closesAt: number }> {
    const instance = await this.loadInstanceWithAccess(user, instanceId);
    if (!instance.closesAt) throw new BadRequestException('This test has no time limit to extend');
    if (instance.closedAt) throw new ConflictException('This test has already closed — answers cannot be un-seen');
    const now = new Date();
    const newClosesAt = new Date(instance.closesAt.getTime() + seconds * 1000);

    const claimed = await this.prisma.activityInstance.updateMany({
      where: { id: instanceId, closedAt: null, closesAt: instance.closesAt },
      data: { closesAt: newClosesAt },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This test just closed, or its time was just changed — refresh and try again');
    }
    await this.prisma.attempt.updateMany({
      where: { activityInstanceId: instanceId, status: AttemptStatus.IN_PROGRESS },
      data: { closesAt: newClosesAt },
    });

    await this.sessions.republish(instance.group.sessionId);
    this.gateway.emitToGroup(instance.groupId, 'test:closing', { activityInstanceId: instanceId, closesAt: newClosesAt.getTime(), serverNow: now.getTime() });
    await this.audit.log({ actorId: user.sub, action: 'test.extend', detail: { instanceId, seconds, closesAt: newClosesAt } });
    return { ok: true, closesAt: newClosesAt.getTime() };
  }

  private async loadInstanceWithAccess(user: JwtPayload, instanceId: string) {
    const instance = await this.prisma.activityInstance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        groupId: true,
        exerciseId: true,
        closesAt: true,
        closedAt: true,
        revealedAt: true,
        exercise: { select: { title: true } },
        group: { select: { sessionId: true, session: { select: { batchId: true, state: true } } } },
      },
    });
    if (!instance || !instance.exerciseId) throw new NotFoundException('Test not found');
    await this.batchAccess.assertCanUseBatch(user, instance.group.session.batchId);
    return instance;
  }
}
