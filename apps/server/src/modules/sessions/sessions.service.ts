import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActivityType, SessionRole, SessionState, UserRole, seatLabel, type CreateSessionDto } from '@lab/shared';
import { mediaRoomForActivity } from '@lab/shared/events';
import { getActivity, hasActivity, validateRoundTableSetup } from '@lab/shared/activities';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { SessionStateService } from '../control/session-state.service';
import { ControlGateway } from '../control/control.gateway';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { BatchAccessService } from '../batches/batch-access.service';
import { BatchesService } from '../batches/batches.service';
import { ClassAccessService } from '../classroom/class-access.service';
import { RoundTableService } from '../round-table/round-table.service';
import { TestClockService } from '../timed-tests/test-clock.service';

/**
 * Session/group CRUD + the server-authoritative state machine (design
 * doc §4.5): DRAFT -> ARMED -> RUNNING <-> PAUSED -> ENDED. Up to 6
 * groups per session, each running one activity, all concurrent and
 * independent (Annexure-I Ser 1).
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly sessionState: SessionStateService,
    private readonly gateway: ControlGateway,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
    private readonly batches: BatchesService,
    private readonly classAccess: ClassAccessService,
    private readonly roundTable: RoundTableService,
    private readonly testClock: TestClockService,
  ) {}

  /**
   * `opts.exerciseIdByGroupIndex` links a group's live ActivityInstance
   * back to the saved Exercise it was launched from (SPEC-mcq-test-timed-reveal.md
   * §6.1 "Launch in lab") — a plain method parameter, not part of
   * `CreateSessionDto`, so it can only ever be set by TimedTestsService.launch
   * calling this method directly, never by an HTTP body. Its presence is
   * also what tells a VOCABULARY_TEST group apart from the public
   * POST /sessions route, which refuses that type outright (see below) —
   * the generic Session Builder used to build unlinked, answer-bearing
   * inline configs for it (session-draft.ts), which "Launch in lab" replaces.
   */
  async create(dto: CreateSessionDto, user: JwtPayload, opts?: { exerciseIdByGroupIndex?: Record<number, string> }) {
    await this.batchAccess.assertCanUseBatch(user, dto.batchId);
    const teacherId = user.sub;
    const indices = new Set(dto.groups.map((g) => g.index));
    if (indices.size !== dto.groups.length) {
      throw new BadRequestException('Group indices must be unique within a session (max 6)');
    }
    if (!opts?.exerciseIdByGroupIndex) {
      const vocab = dto.groups.find((g) => g.activityType === ActivityType.VOCABULARY_TEST);
      if (vocab) {
        throw new BadRequestException(
          `Group ${vocab.index}: vocabulary tests are launched from a saved test's "Launch in lab" button, not the session builder`,
        );
      }
    }
    // Round Table groups are validated here (config defaults materialised) so
    // a session can never arm with a config the floor service cannot run.
    const activityConfigs = dto.groups.map((g) => this.normalizeActivityConfig(g));
    const allStationIds = dto.groups.flatMap((g) => g.memberStationIds);
    if (user.role === UserRole.TEACHER) {
      // Same "only my class" boundary ControlController/CommandsService
      // enforce for live control (design decision: "a teacher sees and
      // controls only the PCs in their active class") — a session built
      // from a station outside the teacher's class would otherwise let
      // them arm/start/monitor a group they have no other control over.
      const controllable = await this.classAccess.filterControllable(user, allStationIds);
      if (controllable.length !== allStationIds.length) {
        throw new ForbiddenException('Some selected computers are not in your class');
      }
    }

    // Who is signed in at each seat right now. Stored on the member so a
    // student's class history knows they took part — the engine itself is
    // seat-based and never reads it.
    const seated = await this.prisma.station.findMany({
      where: { id: { in: [...new Set(allStationIds)] } },
      select: { id: true, seatNo: true, currentUserId: true },
    });
    const studentAt = new Map(seated.map((s) => [s.id, s.currentUserId]));
    if (dto.expectedStudents) await this.assertExpectedStudents(dto.batchId, dto.expectedStudents, seated, allStationIds);

    return this.prisma.classSession.create({
      data: {
        title: dto.title,
        batchId: dto.batchId,
        teacherId,
        state: SessionState.DRAFT,
        groups: {
          create: dto.groups.map((g, i) => ({
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
                studentId: studentAt.get(stationId) ?? null,
              })),
            },
            activity: {
              create: {
                type: g.activityType,
                config: activityConfigs[i] as object,
                dictionaryEnabled: g.dictionaryEnabled,
                exerciseId: opts?.exerciseIdByGroupIndex?.[g.index],
              },
            },
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
   * assigned to (enforcement — see BatchAccessService). `batchId` narrows
   * it to one class (a class's own activity list), checked the same way. */
  async list(user: JwtPayload, batchId?: string) {
    if (batchId) await this.batchAccess.assertCanUseBatch(user, batchId);
    const where = batchId
      ? { batchId }
      : user.role === UserRole.ADMIN
        ? {}
        : { batchId: { in: await this.batchAccess.batchIdsForTeacher(user.sub) } };
    return this.prisma.classSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // activity.type lets the session list route a Round Table group to its own
      // monitor instead of the generic (hidden) listen button; the member
      // students let a class's list say who was in each group.
      include: {
        groups: {
          orderBy: { index: 'asc' },
          select: {
            id: true,
            index: true,
            // id/exerciseId let the session list link a VOCABULARY_TEST
            // group to its live board (/tests/live/:instanceId) the same
            // way activity.type already routes a Round Table group.
            activity: { select: { id: true, type: true, dictionaryEnabled: true, exerciseId: true } },
            members: { select: { student: { select: { id: true, fullName: true } } } },
          },
        },
      },
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
    const draft = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, draft.batchId);
    if (draft.state !== SessionState.DRAFT) {
      throw new BadRequestException(`Cannot arm a session in state ${draft.state}`);
    }

    // Ser 3: automatic grouping / chairman picks must land before any room
    // exists or snapshot is pushed. May add groups, so re-read afterwards.
    await this.roundTable.prepareOnArm(sessionId, user.sub);
    // Arm is when the activity lands on each seat, so whoever sits there now
    // is who does it (automatic grouping may also have re-created members).
    await this.stampMemberStudents(sessionId, { overwrite: true });
    const session = await this.get(sessionId);

    await this.media.ensureBroadcastRoom();
    for (const group of session.groups) {
      // SPEC-mcq-test-timed-reveal.md — a launched vocabulary test group
      // gets NO LiveKit room and no mic grant (registered in the Activity
      // Type Registry as `realtimeRequirements.mediaRoom: 'none'`):
      // without this, every test-taker would be minted a mic-publish
      // token into a shared room with the rest of their own group — a
      // real audio channel between students during a test, and 40
      // needless LiveKit connections. See session-state.service.ts's
      // matching skip.
      if (this.mediaRoomKind(group.activity?.type) === 'none') continue;
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
      // Only from ARMED — a resume from PAUSED must not reset a timed
      // test's deadline (§4.6 "Extending time... Already-submitted
      // students keep waiting" implies the clock keeps running once set;
      // PAUSED is refused entirely while a timed test is open anyway,
      // see TestClockService.hasOpenTimedTest, so this only ever matters
      // for an untimed one, where onSessionStarted is a no-op regardless).
      await this.testClock.onSessionStarted(sessionId, new Date());
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.RUNNING, { startedAt: new Date() });
    await this.stampMemberStudents(sessionId, { overwrite: false });
    await this.roundTableHook(sessionId, SessionState.RUNNING);
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
    // A launched test's closesAt is an absolute server timestamp (§4.1) —
    // pausing the session doesn't stop that clock, so pausing while one is
    // still open would silently eat into the time students have left.
    if (await this.testClock.hasOpenTimedTest(sessionId)) {
      throw new BadRequestException('Cannot pause a session with a vocabulary test still running — use Extend or Reveal now instead');
    }
    const updated = await this.bumpAndPersist(sessionId, SessionState.PAUSED);
    await this.roundTableHook(sessionId, SessionState.PAUSED);
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId: user.sub, action: 'session.pause', detail: { sessionId } });
    return updated;
  }

  /**
   * Teacher control (spec §7): per-group dictionary on/off, live during a
   * session. Bumps the session's `seq` and pushes a fresh snapshot to
   * just that group's own stations (not the whole session) — the other
   * groups' activities/dictionary state are unaffected, and a station's
   * `DesiredStationState.dictionaryEnabled` (the client-side hide) plus
   * DictionaryPolicyService's own cache (server-side enforcement, up to
   * a 1s staleness) both reflect the change within the spec's 2s bound.
   */
  async setGroupDictionary(sessionId: string, groupId: string, enabled: boolean, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
    const group = session.groups.find((g) => g.id === groupId);
    if (!group) throw new NotFoundException('Group not found in this session');
    if (!group.activity) throw new BadRequestException('This group has no activity to configure');

    await this.prisma.activityInstance.update({ where: { id: group.activity.id }, data: { dictionaryEnabled: enabled } });
    await this.bumpAndPersist(sessionId, session.state);
    await this.pushToAllMembers(group.members.map((m) => m.stationId));
    await this.audit.log({ actorId: user.sub, action: 'session.set_group_dictionary', detail: { sessionId, groupId, enabled } });
    return { ok: true as const, enabled };
  }

  async end(sessionId: string, user: JwtPayload) {
    const session = await this.get(sessionId);
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
    if (session.state === SessionState.ENDED) return session;

    // Close open Round Table turns (and drop the floors) before their rooms go.
    await this.roundTableHook(sessionId, SessionState.ENDED);
    for (const group of session.groups) {
      if (this.mediaRoomKind(group.activity?.type) === 'none') continue; // never had a room (see arm())
      await this.media.deleteRoom(mediaRoomForActivity(sessionId, group.id, group.activity?.type ?? ''));
    }
    // SPEC-mcq-test-timed-reveal.md §4.6 "Teacher control: Session End
    // during an open test closes it WITHOUT revealing" (a scope decision
    // for this pass — an accidental End must never publish the answer
    // key). Claims the close now (no new answers accepted from this
    // instant); the actual grade/reveal sequence runs on TestCloseService's
    // next sweep, same durability story as every other close path. A
    // teacher who wants to show answers uses Release afterwards.
    await this.testClock.claimCloseForSession(sessionId, 'SESSION_ENDED', new Date());
    const updated = await this.bumpAndPersist(sessionId, SessionState.ENDED, { endedAt: new Date() });
    // Push a fresh (now empty-for-this-session) snapshot so stations
    // fall back to idle/broadcast-only immediately rather than waiting
    // for the 4h token TTL or a reconnect.
    await this.pushToAllMembers(session.groups.flatMap((g) => g.members.map((m) => m.stationId)));
    await this.audit.log({ actorId: user.sub, action: 'session.end', detail: { sessionId } });
    return updated;
  }

  /** SPEC-mcq-test-timed-reveal.md — a fresh snapshot with no session-state
   * change, used by TestCloseService/TimedTestsService after moving a
   * timed instance's clock (extend, reveal, close) so every affected
   * station converges within the spec's 2s bound. Bumping `seq` matters:
   * without it, a snapshot that only changed `activity.timedTest` could be
   * (wrongly) treated as a duplicate/stale push by a client comparing seq. */
  async republish(sessionId: string, stationIds?: string[]): Promise<void> {
    const session = await this.get(sessionId);
    await this.bumpAndPersist(sessionId, session.state);
    const targets = stationIds ?? session.groups.flatMap((g) => g.members.map((m) => m.stationId));
    await this.pushToAllMembers(targets);
  }

  /**
   * A class's activity screen picks STUDENTS; the engine delivers to SEATS.
   * Refuses the session if a picked seat now has someone else (or nobody)
   * signed in, or a picked student is not in this class — so a stale pick
   * can never send an activity to the wrong person.
   */
  private async assertExpectedStudents(
    batchId: string,
    expected: Record<string, string>,
    seated: Array<{ id: string; seatNo: number | null; currentUserId: string | null }>,
    memberStationIds: string[],
  ): Promise<void> {
    for (const [stationId, studentId] of Object.entries(expected)) {
      if (!memberStationIds.includes(stationId)) {
        throw new BadRequestException('A picked student is not in any group');
      }
      const station = seated.find((s) => s.id === stationId);
      if (!station || station.currentUserId !== studentId) {
        const seat = station ? `System ${seatLabel(station.seatNo)}` : 'their computer';
        throw new ConflictException(`A picked student is no longer signed in at ${seat}. Refresh and pick again.`);
      }
    }
    const studentIds = [...new Set(Object.values(expected))];
    const enrolled = await this.prisma.enrollment.count({ where: { batchId, userId: { in: studentIds } } });
    if (enrolled !== studentIds.length) {
      throw new BadRequestException('Some picked students are not in this class');
    }
  }

  /**
   * Records who is signed in at each member seat (SessionMember.studentId).
   * `overwrite` re-stamps every seat that has someone signed in — used at arm,
   * when the activity actually lands on the seats; otherwise only seats still
   * unattributed are filled. A seat with nobody signed in keeps what it had.
   */
  private async stampMemberStudents(sessionId: string, { overwrite }: { overwrite: boolean }): Promise<void> {
    const members = await this.prisma.sessionMember.findMany({
      where: { group: { sessionId }, ...(overwrite ? {} : { studentId: null }) },
      select: { id: true, studentId: true, station: { select: { currentUserId: true } } },
    });
    for (const m of members) {
      const current = m.station.currentUserId;
      if (!current || current === m.studentId) continue;
      await this.prisma.sessionMember.update({ where: { id: m.id }, data: { studentId: current } });
    }
  }

  /** Round Table's floor/turn bookkeeping must never fail a state change. */
  private async roundTableHook(sessionId: string, state: string): Promise<void> {
    try {
      await this.roundTable.onSessionState(sessionId, state);
    } catch (err) {
      this.logger.error(`Round Table hook for ${state} failed on session ${sessionId}`, err as Error);
    }
  }

  /**
   * Validates a group's activity config and returns what to store. Only
   * ROUND_TABLE has server-side rules today (spec section 7.1): every manual
   * group needs >= 2 members and a chairman among them; automatic
   * participant splitting needs a target size and an automatic chairman.
   */
  private normalizeActivityConfig(g: CreateSessionDto['groups'][number]): unknown {
    if (g.activityType !== ActivityType.ROUND_TABLE) return g.activityConfig;
    const setup = validateRoundTableSetup({
      config: g.activityConfig,
      memberStationIds: g.memberStationIds,
      chairmanStationId: g.chairmanStationId,
    });
    if (!setup.ok) throw new BadRequestException(`Group ${g.index}: ${setup.errors.join('; ')}`);
    return setup.config;
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

  /** `getActivity` throws on an unregistered type, so this goes through
   * `hasActivity` first — mirrors SessionStateService.getDesiredState's
   * own guard against a type the registry doesn't (yet) know. */
  private mediaRoomKind(type: string | undefined): string {
    if (!type || !hasActivity(type as ActivityType)) return 'default';
    return getActivity(type as ActivityType).realtimeRequirements.mediaRoom;
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
