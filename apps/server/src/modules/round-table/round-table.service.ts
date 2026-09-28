import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ActivityType, SessionRole, SessionState, type RoundTableFloor } from '@lab/shared';
import { zRoundTableConfig, type SpeakingTurn } from '@lab/shared/activities';
import { groupRoom, mediaRoomForActivity, roundTableDashRoom, type RtGroupRef } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { ControlGateway } from '../control/control.gateway';
import { PresenceService } from '../control/presence.service';
import { SessionStateService } from '../control/session-state.service';
import { RoundTableFloorStore, type RoundTableGroupState } from '../control/round-table-floor.store';
import { AuditService } from '../audit/audit.service';
import { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';
import { summariseTurns, type ReviewTurn } from './round-table-review';
import {
  AssignmentError,
  MAX_SESSION_GROUPS,
  nextInRotation,
  pickChairman,
  splitIntoGroups,
} from './round-table-assignment';

/** Manual-chair groups freeze, and automatic-chair groups promote, after this long offline. */
export const CHAIRMAN_OFFLINE_GRACE_MS = 20_000;
/** A chairman's speech is one turn until they stay silent this long; shorter turns are dropped. */
export const CHAIR_SILENCE_MS = 1_500;
const RECONCILE_MS = 5_000;
/** Consecutive reconcile passes (5s each) a teacher may be absent from the room before we drop them. */
const TEACHER_MISS_LIMIT = 3;

interface OpenTurn {
  role: SpeakingTurn['role'];
  stationId: string | null;
  studentId: string | null;
  teacherUserId: string | null;
  startedAt: number;
  /** Chairman turns only: when speech was last reported. */
  lastSpeechAt?: number;
}

interface TeacherPresence {
  userId: string;
  misses: number;
}

export interface TeacherJoin {
  room: string;
  token: string;
  identity: string;
}

/**
 * Ser 3 Round Table — the server owns the floor (spec D1). Every rule in
 * here is enforced against the AUTHENTICATED station socket's identity: the
 * `stationId` a client sends is only ever a grant target, never who is
 * calling. Floor changes are enforced by updating LiveKit publish
 * permissions, so a modified client cannot talk out of turn; the client UI
 * merely reflects the state.
 *
 * Nothing here trusts a client clock: turn times come from Date.now() on
 * this process, relative to when the activity started.
 */
@Injectable()
export class RoundTableService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoundTableService.name);
  private readonly memberTurns = new Map<string, OpenTurn>();
  private readonly teacherTurns = new Map<string, OpenTurn>();
  private readonly chairTurns = new Map<string, OpenTurn>();
  private readonly chairSilenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly chairOfflineTimers = new Map<string, NodeJS.Timeout>();
  private readonly rotationTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingRotation = new Set<string>();
  private readonly applyChains = new Map<string, Promise<unknown>>();
  /** One teacher per group; a teacher is in at most one group at a time. */
  private readonly teachers = new Map<string, TeacherPresence>();
  private readonly teacherGroupOf = new Map<string, string>();
  private reconcileTimer?: NodeJS.Timeout;
  private unsubscribePresence?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly gateway: ControlGateway,
    private readonly presence: PresenceService,
    private readonly sessionState: SessionStateService,
    private readonly store: RoundTableFloorStore,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  onModuleInit(): void {
    this.unsubscribePresence = this.presence.onChange((stationId, online) => this.onPresence(stationId, online));
    // LiveKit is the source of truth for who may publish. This repairs any
    // drift (a stale token after a full reconnect, a server restart, a
    // modified client) and notices a teacher whose tab simply closed.
    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_MS);
  }

  onModuleDestroy(): void {
    this.unsubscribePresence?.();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const timers of [this.chairSilenceTimers, this.chairOfflineTimers, this.rotationTimers]) {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    }
  }

  // ------------------------------------------------------------------ helpers

  private async requireGroup(sessionId: string, groupId: string): Promise<RoundTableGroupState> {
    const g = await this.store.ensure(groupId);
    if (!g || g.sessionId !== sessionId) throw new NotFoundException('That Round Table group is not running');
    return g;
  }

  private requireMember(g: RoundTableGroupState, stationId: string): void {
    if (!g.members.some((m) => m.stationId === stationId)) throw new ForbiddenException('You are not in this group');
  }

  /** A grant/chair TARGET that is not in the group: the caller did nothing
   * forbidden, they named a bad seat — so 400, worded about the seat. */
  private requireTarget(g: RoundTableGroupState, stationId: string): void {
    if (!g.members.some((m) => m.stationId === stationId)) throw new BadRequestException('That seat is not in this group');
  }

  private requireRunning(g: RoundTableGroupState): void {
    if (g.floor.phase !== 'RUNNING') throw new BadRequestException('The discussion is not running');
  }

  private roomOf(g: RoundTableGroupState): string {
    return mediaRoomForActivity(g.sessionId, g.groupId, ActivityType.ROUND_TABLE);
  }

  private teacherIdentity(userId: string): string {
    return `st:teacher:${userId}`;
  }

  /** Who may publish a mic right now (spec D3). Members are blocked unless
   * they are the chairman or hold the floor; the teacher only while speaking. */
  allowedIdentities(g: RoundTableGroupState): Set<string> {
    const f = g.floor;
    const out = new Set<string>();
    if (f.phase === 'RUNNING') {
      out.add(`st:${f.chairmanStationId}`);
      if (f.speakerStationId) out.add(`st:${f.speakerStationId}`);
    }
    const teacher = this.teachers.get(g.groupId);
    if (teacher && f.teacher === 'speaking') out.add(this.teacherIdentity(teacher.userId));
    return out;
  }

  // -------------------------------------------------------- commit / emit / sync

  /** Every mutation ends here: bump seq, persist, emit, then enforce. */
  private async commit(g: RoundTableGroupState): Promise<void> {
    g.floor.seq += 1;
    this.store.persist(g);
    this.emitFloor(g);
    await this.applyPermissions(g.groupId);
    if (this.pendingRotation.has(g.groupId) && !g.floor.speakerStationId) {
      this.pendingRotation.delete(g.groupId);
      await this.rotateNow(g);
    }
  }

  private emitFloor(g: RoundTableGroupState): void {
    const floor: RoundTableFloor = { ...g.floor, queue: [...g.floor.queue] };
    const server = this.gateway.server;
    server.to(groupRoom(g.groupId)).emit('rt:floor', floor);
    server.to(roundTableDashRoom(g.sessionId)).emit('rt:floor', floor);
  }

  private emitAlert(g: RoundTableGroupState, kind: 'chairman_offline' | 'chairman_promoted', stationId: string): void {
    this.gateway.server.to(roundTableDashRoom(g.sessionId)).emit('rt:alert', {
      sessionId: g.sessionId,
      groupId: g.groupId,
      kind,
      stationId,
    });
  }

  /** Serialised per group so two quick mutations cannot interleave their
   * LiveKit calls; the allowed set is recomputed when each one runs. */
  private applyPermissions(groupId: string, reconcile = false): Promise<{ teacherGone: boolean }> {
    const prev = this.applyChains.get(groupId) ?? Promise.resolve();
    const next = prev
      .then(() => this.doApply(groupId, reconcile))
      .catch((err: Error) => {
        this.logger.warn(`apply permissions ${groupId} failed: ${err.message}`);
        return { teacherGone: false };
      });
    this.applyChains.set(groupId, next);
    return next;
  }

  /** Diff-applies against LiveKit's own view: only participants whose actual
   * publish right differs from the allowed set are touched. */
  private async doApply(groupId: string, reconcile: boolean): Promise<{ teacherGone: boolean }> {
    const g = this.store.get(groupId);
    if (!g) return { teacherGone: false };
    const room = this.roomOf(g);
    const participants = await this.media.listParticipants(room);
    const allowed = this.allowedIdentities(g);
    const tracked = new Set(g.members.map((m) => `st:${m.stationId}`));
    const teacher = this.teachers.get(groupId);
    if (teacher) tracked.add(this.teacherIdentity(teacher.userId));
    for (const p of participants) {
      // Any instructor identity in the room is governed too, so a teacher who
      // left (or whose kick failed) can never keep an open mic by accident.
      if (!tracked.has(p.identity) && !p.identity.startsWith('st:teacher:')) continue;
      const want = allowed.has(p.identity);
      if (want === (p.permission?.canPublish ?? false)) continue;
      try {
        await this.media.setMicPermission(room, p.identity, want);
      } catch (err) {
        this.logger.warn(`setMicPermission ${p.identity} failed: ${(err as Error).message}`);
      }
    }
    let teacherGone = false;
    if (reconcile && teacher) {
      const present = participants.some((p) => p.identity === this.teacherIdentity(teacher.userId));
      teacher.misses = present ? 0 : teacher.misses + 1;
      teacherGone = teacher.misses >= TEACHER_MISS_LIMIT;
    }
    return { teacherGone };
  }

  private async reconcile(): Promise<void> {
    for (const g of this.store.all()) {
      const teacher = this.teachers.get(g.groupId);
      if (g.floor.phase === 'ARMED' && !teacher) continue;
      const { teacherGone } = await this.applyPermissions(g.groupId, true);
      if (teacherGone && teacher) await this.removeTeacher(g, teacher.userId, false);
    }
  }

  // ------------------------------------------------------------------- turns

  private relMs(g: RoundTableGroupState, at: number): number {
    return Math.max(0, at - (g.startedAtMs ?? at));
  }

  private async recordTurn(g: RoundTableGroupState, turn: OpenTurn, endAt: number, minMs = 0): Promise<void> {
    const startMs = this.relMs(g, turn.startedAt);
    const endMs = this.relMs(g, endAt);
    if (endMs - startMs <= 0 || endMs - startMs < minMs) return;
    try {
      await this.prisma.roundTableTurn.create({
        data: {
          activityInstanceId: g.instanceId,
          stationId: turn.stationId,
          studentId: turn.studentId,
          teacherUserId: turn.teacherUserId,
          role: turn.role,
          startMs,
          endMs,
        },
      });
    } catch (err) {
      this.logger.warn(`could not record turn for group ${g.groupId}: ${(err as Error).message}`);
    }
  }

  private openMemberTurn(g: RoundTableGroupState, stationId: string): void {
    const turn: OpenTurn = { role: 'MEMBER', stationId, studentId: null, teacherUserId: null, startedAt: Date.now() };
    this.memberTurns.set(g.groupId, turn);
    this.stampStudent(turn, stationId);
  }

  /** Who is signed in at the speaking seat — what a student's class history
   * reads their floor time by. The seat may be unclaimed; studentId is
   * best-effort and nullable. */
  private stampStudent(turn: OpenTurn, stationId: string): void {
    void this.prisma.station
      .findUnique({ where: { id: stationId }, select: { currentUserId: true } })
      .then((s) => {
        turn.studentId = s?.currentUserId ?? null;
      })
      .catch(() => undefined);
  }

  private closeMemberTurn(g: RoundTableGroupState, at = Date.now()): Promise<void> {
    const turn = this.memberTurns.get(g.groupId);
    if (!turn) return Promise.resolve();
    this.memberTurns.delete(g.groupId);
    return this.recordTurn(g, turn, at);
  }

  private closeTeacherTurn(g: RoundTableGroupState, at = Date.now()): Promise<void> {
    const turn = this.teacherTurns.get(g.groupId);
    if (!turn) return Promise.resolve();
    this.teacherTurns.delete(g.groupId);
    return this.recordTurn(g, turn, at);
  }

  /** The chairman talks continuously, so their turns follow voice activity
   * (spec 6.6), not floor state. Bursts shorter than CHAIR_SILENCE_MS are noise. */
  private closeChairTurn(g: RoundTableGroupState): Promise<void> {
    const timer = this.chairSilenceTimers.get(g.groupId);
    if (timer) clearTimeout(timer);
    this.chairSilenceTimers.delete(g.groupId);
    const turn = this.chairTurns.get(g.groupId);
    if (!turn) return Promise.resolve();
    this.chairTurns.delete(g.groupId);
    return this.recordTurn(g, turn, turn.lastSpeechAt ?? Date.now(), CHAIR_SILENCE_MS);
  }

  // ---------------------------------------------------- station-facing rules

  async requestMic(callerStationId: string, ref: RtGroupRef): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    this.requireRunning(g);
    const f = g.floor;
    if (!g.config.micRequestQueueEnabled) throw new BadRequestException('Mic requests are off — ask the chairman for the floor');
    if (f.chairmanOffline) throw new BadRequestException('The chairman is disconnected');
    if (callerStationId === f.chairmanStationId) throw new BadRequestException('The chairman does not need to request the floor');
    if (f.speakerStationId === callerStationId) throw new BadRequestException('You already have the floor');
    if (f.queue.includes(callerStationId)) throw new BadRequestException('You are already in the queue');
    f.queue.push(callerStationId);
    await this.commit(g);
  }

  async cancelRequest(callerStationId: string, ref: RtGroupRef): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    if (!g.floor.queue.includes(callerStationId)) return;
    g.floor.queue = g.floor.queue.filter((id) => id !== callerStationId);
    await this.commit(g);
  }

  /** Chairman only. `targetStationId` is the grant target, never the caller. */
  async grantFloor(callerStationId: string, ref: RtGroupRef, targetStationId: string): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    if (callerStationId !== g.floor.chairmanStationId) throw new ForbiddenException('Only the chairman can give the floor');
    await this.grant(g, targetStationId);
  }

  /** Chairman only. */
  async revokeFloor(callerStationId: string, ref: RtGroupRef): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    if (callerStationId !== g.floor.chairmanStationId) throw new ForbiddenException('Only the chairman can take the floor back');
    await this.revoke(g);
  }

  /** The current speaker only. */
  async yieldFloor(callerStationId: string, ref: RtGroupRef): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    if (g.floor.speakerStationId !== callerStationId) throw new ForbiddenException('You do not have the floor');
    await this.revoke(g);
  }

  /** A station just (re)joined the group's LiveKit room: apply its right now. */
  async sync(callerStationId: string, ref: RtGroupRef): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    await this.applyPermissions(g.groupId);
  }

  /** The chairman's own voice activity; the timestamp is the SERVER's. */
  async chairSpeaking(callerStationId: string, ref: RtGroupRef, speaking: boolean): Promise<void> {
    const g = await this.requireGroup(ref.sessionId, ref.groupId);
    this.requireMember(g, callerStationId);
    if (callerStationId !== g.floor.chairmanStationId || g.floor.phase !== 'RUNNING') return;
    const now = Date.now();
    const silence = this.chairSilenceTimers.get(g.groupId);
    if (silence) clearTimeout(silence);
    this.chairSilenceTimers.delete(g.groupId);
    const open = this.chairTurns.get(g.groupId);
    if (speaking) {
      if (open) open.lastSpeechAt = now;
      else {
        const turn: OpenTurn = { role: 'CHAIRMAN', stationId: callerStationId, studentId: null, teacherUserId: null, startedAt: now, lastSpeechAt: now };
        this.chairTurns.set(g.groupId, turn);
        this.stampStudent(turn, callerStationId);
      }
      return;
    }
    if (!open) return;
    open.lastSpeechAt = now;
    this.chairSilenceTimers.set(g.groupId, setTimeout(() => void this.closeChairTurn(g), CHAIR_SILENCE_MS));
  }

  // --------------------------------------------------------- floor mutators

  private async grant(g: RoundTableGroupState, target: string): Promise<void> {
    this.requireRunning(g);
    const f = g.floor;
    if (f.chairmanOffline) throw new BadRequestException('The chairman is disconnected');
    if (target === f.chairmanStationId) throw new BadRequestException('The chairman already has the floor');
    this.requireTarget(g, target);
    if (f.speakerStationId === target) return;
    await this.closeMemberTurn(g);
    f.speakerStationId = target;
    f.turnStartedAt = Date.now();
    f.queue = f.queue.filter((id) => id !== target);
    this.openMemberTurn(g, target);
    await this.commit(g);
  }

  private async revoke(g: RoundTableGroupState): Promise<void> {
    const f = g.floor;
    if (!f.speakerStationId) return;
    await this.closeMemberTurn(g);
    f.speakerStationId = null;
    f.turnStartedAt = null;
    await this.commit(g);
  }

  /** Hand the chair to `newId`: roles are real DB state (the snapshot's
   * `role` comes from SessionMember), so the group's snapshots are republished. */
  private async changeChairman(g: RoundTableGroupState, newId: string): Promise<void> {
    const f = g.floor;
    const oldId = f.chairmanStationId;
    if (oldId === newId) return;
    this.requireTarget(g, newId);
    await this.closeChairTurn(g);
    if (f.speakerStationId === newId) {
      await this.closeMemberTurn(g);
      f.speakerStationId = null;
      f.turnStartedAt = null;
    }
    f.queue = f.queue.filter((id) => id !== newId);
    f.chairmanStationId = newId;
    f.chairmanOffline = false;
    await this.prisma.$transaction([
      this.prisma.sessionMember.updateMany({ where: { groupId: g.groupId, stationId: oldId }, data: { role: SessionRole.MEMBER } }),
      this.prisma.sessionMember.updateMany({ where: { groupId: g.groupId, stationId: newId }, data: { role: SessionRole.CHAIRMAN } }),
    ]);
    await this.commit(g);
    await this.republishGroup(g);
  }

  private async republishGroup(g: RoundTableGroupState): Promise<void> {
    for (const m of g.members) {
      try {
        this.gateway.pushSnapshot(m.stationId, await this.sessionState.getDesiredState(m.stationId));
      } catch (err) {
        this.logger.warn(`snapshot push to ${m.stationId} failed: ${(err as Error).message}`);
      }
    }
  }

  /** The next ONLINE member after `afterStationId` in seat order (wrapping). */
  private nextOnlineMember(g: RoundTableGroupState, afterStationId: string): string | null {
    return nextInRotation(g.members, afterStationId, (id) => this.presence.isOnline(id));
  }

  private async rotateNow(g: RoundTableGroupState): Promise<void> {
    const next = this.nextOnlineMember(g, g.floor.chairmanStationId);
    if (next) await this.changeChairman(g, next);
  }

  // ------------------------------------------------------------ disconnects

  private onPresence(stationId: string, online: boolean): void {
    for (const g of this.store.all()) {
      if (!g.members.some((m) => m.stationId === stationId)) continue;
      const work = online ? this.stationOnline(g, stationId) : this.stationOffline(g, stationId);
      work.catch((err: Error) => this.logger.warn(`presence handling for ${stationId} failed: ${err.message}`));
    }
  }

  /** A speaker that drops ends their turn at once; a chairman that stays
   * away for CHAIRMAN_OFFLINE_GRACE_MS is promoted past (automatic chair) or
   * freezes the floor pending a teacher decision (manual chair). */
  private async stationOffline(g: RoundTableGroupState, stationId: string): Promise<void> {
    const f = g.floor;
    let changed = false;
    if (f.queue.includes(stationId)) {
      f.queue = f.queue.filter((id) => id !== stationId);
      changed = true;
    }
    if (f.speakerStationId === stationId) {
      await this.closeMemberTurn(g);
      f.speakerStationId = null;
      f.turnStartedAt = null;
      changed = true;
    }
    if (stationId === f.chairmanStationId && f.phase === 'RUNNING') {
      await this.closeChairTurn(g);
      this.armChairOfflineTimer(g);
    }
    if (changed) await this.commit(g);
  }

  private async stationOnline(g: RoundTableGroupState, stationId: string): Promise<void> {
    if (stationId !== g.floor.chairmanStationId) return;
    const timer = this.chairOfflineTimers.get(g.groupId);
    if (timer) clearTimeout(timer);
    this.chairOfflineTimers.delete(g.groupId);
    if (g.floor.chairmanOffline) {
      g.floor.chairmanOffline = false;
      await this.commit(g);
    }
  }

  private armChairOfflineTimer(g: RoundTableGroupState): void {
    const existing = this.chairOfflineTimers.get(g.groupId);
    if (existing) clearTimeout(existing);
    this.chairOfflineTimers.set(
      g.groupId,
      setTimeout(() => {
        this.chairOfflineTimers.delete(g.groupId);
        this.chairmanStillOffline(g.groupId).catch((err: Error) =>
          this.logger.warn(`chairman offline handling failed: ${err.message}`),
        );
      }, CHAIRMAN_OFFLINE_GRACE_MS),
    );
  }

  private async chairmanStillOffline(groupId: string): Promise<void> {
    const g = this.store.get(groupId);
    if (!g || g.floor.phase !== 'RUNNING' || this.presence.isOnline(g.floor.chairmanStationId)) return;
    const gone = g.floor.chairmanStationId;
    const next = g.config.chairmanAssignment === 'automatic' ? this.nextOnlineMember(g, gone) : null;
    if (next) {
      await this.changeChairman(g, next);
      this.emitAlert(g, 'chairman_promoted', next);
      return;
    }
    g.floor.chairmanOffline = true;
    await this.commit(g);
    this.emitAlert(g, 'chairman_offline', gone);
  }

  // ----------------------------------------------------- teacher (RT-8 / RT-9)

  private async teacherGroup(user: JwtPayload, sessionId: string, groupId: string): Promise<RoundTableGroupState> {
    await this.assertSessionAccess(user, sessionId);
    return this.requireGroup(sessionId, groupId);
  }

  /** Only a teacher of this session's batch (or an admin) — the real "my
   * class" boundary, same check every SessionsService transition uses. */
  async assertSessionAccess(user: JwtPayload, sessionId: string): Promise<void> {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId }, select: { batchId: true } });
    if (!session) throw new NotFoundException('Session not found');
    await this.batchAccess.assertCanUseBatch(user, session.batchId);
  }

  /** Subscribe-only token; NOT hidden — students see "Teacher is listening" (D4). */
  async listen(user: JwtPayload, sessionId: string, groupId: string): Promise<TeacherJoin> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    const holder = this.teachers.get(groupId);
    if (holder && holder.userId !== user.sub) throw new ConflictException('Another instructor is already in this group');
    // Switching groups leaves the previous one first, so audio never mixes.
    const previous = this.teacherGroupOf.get(user.sub);
    if (previous && previous !== groupId) {
      const prevGroup = this.store.get(previous);
      if (prevGroup) await this.removeTeacher(prevGroup, user.sub, true);
    }
    this.teachers.set(groupId, { userId: user.sub, misses: 0 });
    this.teacherGroupOf.set(user.sub, groupId);
    if (g.floor.teacher === 'absent') g.floor.teacher = 'listening';
    const room = this.roomOf(g);
    const token = await this.media.mintMicGatedToken({
      stationId: `teacher:${user.sub}`,
      displayName: `Teacher (${user.serviceNumber})`,
      room,
      canPublishMic: false,
      role: 'TEACHER',
    });
    await this.commit(g);
    await this.audit.log({ actorId: user.sub, action: 'round_table.listen', detail: { sessionId, groupId } });
    return { room, token, identity: this.teacherIdentity(user.sub) };
  }

  async participate(user: JwtPayload, sessionId: string, groupId: string): Promise<TeacherJoin> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    if (g.floor.phase === 'ARMED') throw new BadRequestException('The discussion has not started');
    const join = await this.listen(user, sessionId, groupId);
    if (g.floor.teacher !== 'speaking') {
      g.floor.teacher = 'speaking';
      this.teacherTurns.set(groupId, {
        role: 'TEACHER',
        stationId: null,
        studentId: null,
        teacherUserId: user.sub,
        startedAt: Date.now(),
      });
      await this.commit(g);
    }
    await this.audit.log({ actorId: user.sub, action: 'round_table.participate', detail: { sessionId, groupId } });
    return join;
  }

  async leave(user: JwtPayload, sessionId: string, groupId: string): Promise<void> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    await this.removeTeacher(g, user.sub, true);
    await this.audit.log({ actorId: user.sub, action: 'round_table.leave', detail: { sessionId, groupId } });
  }

  /** `kick`: also remove the participant from LiveKit (false when they
   * already vanished, i.e. the reconcile loop found them gone). */
  private async removeTeacher(g: RoundTableGroupState, userId: string, kick: boolean): Promise<void> {
    const teacher = this.teachers.get(g.groupId);
    if (!teacher || teacher.userId !== userId) return;
    await this.closeTeacherTurn(g);
    this.teachers.delete(g.groupId);
    this.teacherGroupOf.delete(userId);
    g.floor.teacher = 'absent';
    if (kick) await this.media.removeParticipant(this.roomOf(g), this.teacherIdentity(userId));
    await this.commit(g);
  }

  async teacherGrant(user: JwtPayload, sessionId: string, groupId: string, stationId: string): Promise<void> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    await this.grant(g, stationId);
    await this.audit.log({ actorId: user.sub, action: 'round_table.grant', detail: { sessionId, groupId, stationId } });
  }

  async teacherRevoke(user: JwtPayload, sessionId: string, groupId: string): Promise<void> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    await this.revoke(g);
    await this.audit.log({ actorId: user.sub, action: 'round_table.revoke', detail: { sessionId, groupId } });
  }

  /** Teacher override, also the answer to "Chairman disconnected — reassign?". */
  async setChairman(user: JwtPayload, sessionId: string, groupId: string, stationId: string): Promise<void> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    await this.changeChairman(g, stationId);
    await this.audit.log({ actorId: user.sub, action: 'round_table.chairman', detail: { sessionId, groupId, stationId } });
  }

  /** Ends the current turn, clears the queue, and silences every mic still open. */
  async muteAll(user: JwtPayload, sessionId: string, groupId: string): Promise<void> {
    const g = await this.teacherGroup(user, sessionId, groupId);
    await this.closeMemberTurn(g);
    g.floor.speakerStationId = null;
    g.floor.turnStartedAt = null;
    g.floor.queue = [];
    await this.commit(g);
    const room = this.roomOf(g);
    try {
      for (const p of await this.media.listParticipants(room)) {
        if (p.identity.startsWith('st:') && !p.identity.startsWith('st:teacher:')) await this.media.muteMicTracks(room, p);
      }
    } catch (err) {
      this.logger.warn(`mute-all server mute failed: ${(err as Error).message}`);
    }
    await this.audit.log({ actorId: user.sub, action: 'round_table.mute_all', detail: { sessionId, groupId } });
  }

  // ------------------------------------------------------ session lifecycle

  /** Called by SessionsService after every state change (RUNNING / PAUSED /
   * ENDED). Pause freezes the discussion: the turn ends, nobody but a
   * speaking teacher may publish. End closes every open turn. */
  async onSessionState(sessionId: string, state: string): Promise<void> {
    const rows = await this.prisma.sessionGroup.findMany({
      where: { sessionId, activity: { type: ActivityType.ROUND_TABLE } },
      select: { id: true },
    });
    for (const { id } of rows) {
      const g = state === SessionState.ENDED ? this.store.get(id) : await this.store.refresh(id);
      if (!g) continue;
      if (state === SessionState.RUNNING) await this.onRunning(g);
      else if (state === SessionState.PAUSED) await this.onPaused(g);
      else if (state === SessionState.ENDED) await this.onEnded(g);
    }
  }

  private async onRunning(g: RoundTableGroupState): Promise<void> {
    this.startRotation(g);
    if (!this.presence.isOnline(g.floor.chairmanStationId)) this.armChairOfflineTimer(g);
    await this.commit(g);
  }

  private async onPaused(g: RoundTableGroupState): Promise<void> {
    await this.closeMemberTurn(g);
    await this.closeChairTurn(g);
    g.floor.speakerStationId = null;
    g.floor.turnStartedAt = null;
    this.stopTimers(g.groupId);
    await this.commit(g);
  }

  private async onEnded(g: RoundTableGroupState): Promise<void> {
    await Promise.all([this.closeMemberTurn(g), this.closeChairTurn(g), this.closeTeacherTurn(g)]);
    const teacher = this.teachers.get(g.groupId);
    if (teacher) this.teacherGroupOf.delete(teacher.userId);
    this.teachers.delete(g.groupId);
    this.stopTimers(g.groupId);
    this.pendingRotation.delete(g.groupId);
    this.applyChains.delete(g.groupId);
    this.store.drop(g.groupId);
  }

  private stopTimers(groupId: string): void {
    for (const timers of [this.rotationTimers, this.chairOfflineTimers]) {
      const t = timers.get(groupId);
      if (t) clearTimeout(t);
      timers.delete(groupId);
    }
  }

  /** Automatic chair + 'rotate': hand the chair on every rotateEverySec. */
  private startRotation(g: RoundTableGroupState): void {
    const c = g.config;
    const existing = this.rotationTimers.get(g.groupId);
    if (existing) clearInterval(existing);
    this.rotationTimers.delete(g.groupId);
    if (c.chairmanAssignment !== 'automatic' || c.chairmanStrategy !== 'rotate' || !c.rotateEverySec) return;
    this.rotationTimers.set(g.groupId, setInterval(() => this.rotationTick(g.groupId), c.rotateEverySec * 1000));
  }

  /** A rotation that falls during someone's turn waits until that turn ends
   * (commit() runs it the moment the floor is free). */
  private rotationTick(groupId: string): void {
    const g = this.store.get(groupId);
    if (!g || g.floor.phase !== 'RUNNING') return;
    if (g.floor.speakerStationId) {
      this.pendingRotation.add(groupId);
      return;
    }
    this.rotateNow(g).catch((err: Error) => this.logger.warn(`chairman rotation failed: ${err.message}`));
  }

  // ---------------------------------------------------------------- queries

  /** Live floors of one session — sent to a dashboard when it subscribes. */
  floorsForSession(sessionId: string): RoundTableFloor[] {
    return this.store
      .all()
      .filter((g) => g.sessionId === sessionId)
      .map((g) => ({ ...g.floor, queue: [...g.floor.queue] }));
  }

  /**
   * Post-session review (spec 7.3): per-group turn timeline, recordings, and
   * total speaking time per station (to spot a student who never took the
   * floor). Available for any Round Table group of a session the teacher may
   * use, live or ended — a teacher checking mid-discussion sees it so far.
   */
  async review(user: JwtPayload, sessionId: string, groupId: string) {
    await this.assertSessionAccess(user, sessionId);
    const group = await this.prisma.sessionGroup.findUnique({
      where: { id: groupId },
      include: {
        activity: true,
        members: { include: { station: { select: { seatNo: true, currentUser: { select: { fullName: true } } } } } },
      },
    });
    if (!group || group.sessionId !== sessionId || group.activity?.type !== ActivityType.ROUND_TABLE) {
      throw new NotFoundException('That is not a Round Table group of this session');
    }
    const members = group.members
      .map((m) => ({ stationId: m.stationId, seatNo: m.station.seatNo, studentName: m.station.currentUser?.fullName ?? null }))
      .sort((a, b) => (a.seatNo ?? 1e9) - (b.seatNo ?? 1e9));
    const [turns, recordings] = await Promise.all([
      this.prisma.roundTableTurn.findMany({ where: { activityInstanceId: group.activity.id }, orderBy: { startMs: 'asc' } }),
      this.prisma.recording.findMany({ where: { activityInstanceId: group.activity.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const startedAtMs = group.activity.startedAt?.getTime() ?? null;
    const { totals, teacherMs } = summariseTurns(members.map((m) => m.stationId), turns as ReviewTurn[]);
    return {
      groupId,
      topic: (group.activity.config as { topic?: string } | null)?.topic ?? '',
      members,
      turns: turns.map((t) => ({ stationId: t.stationId, studentId: t.studentId, teacherUserId: t.teacherUserId, role: t.role, startMs: t.startMs, endMs: t.endMs })),
      totals,
      teacherMs,
      recordings: recordings.map((r) => ({
        id: r.id,
        stationId: r.stationId,
        status: r.status,
        durationMs: r.durationMs,
        // Seek offset within the group's shared timeline (spec 7.3: "clicking a
        // segment seeks the recording") — null until both timestamps exist.
        offsetMs: startedAtMs !== null ? Math.max(0, r.createdAt.getTime() - startedAtMs) : null,
      })),
    };
  }

  /** Everything the teacher monitor needs to draw one session's groups. */
  async overview(user: JwtPayload, sessionId: string) {
    await this.assertSessionAccess(user, sessionId);
    const session = await this.prisma.classSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { state: true, title: true },
    });
    const groups = await this.prisma.sessionGroup.findMany({
      where: { sessionId, activity: { type: ActivityType.ROUND_TABLE } },
      orderBy: { index: 'asc' },
      include: {
        activity: true,
        members: { include: { station: { select: { seatNo: true, currentUser: { select: { fullName: true } } } } } },
      },
    });
    const out = [];
    for (const grp of groups) {
      const live = await this.store.ensure(grp.id);
      out.push({
        groupId: grp.id,
        index: grp.index,
        topic: live?.config.topic ?? (grp.activity?.config as { topic?: string } | null)?.topic ?? '',
        config: live?.config ?? null,
        floor: live ? { ...live.floor, queue: [...live.floor.queue] } : null,
        members: grp.members
          .map((m) => ({
            stationId: m.stationId,
            seatNo: m.station.seatNo,
            studentName: m.station.currentUser?.fullName ?? null,
            role: m.role,
            online: this.presence.isOnline(m.stationId),
          }))
          .sort((a, b) => (a.seatNo ?? 1e9) - (b.seatNo ?? 1e9)),
      });
    }
    return { sessionId, title: session.title, state: session.state, groups: out };
  }

  // ---------------------------------------------------------------- arm time

  private loadRoundTableGroups(sessionId: string) {
    return this.prisma.sessionGroup.findMany({
      where: { sessionId, activity: { type: ActivityType.ROUND_TABLE } },
      orderBy: { index: 'asc' },
      include: { activity: true, members: { include: { station: { select: { seatNo: true, currentUserId: true } } } } },
    });
  }

  /**
   * Runs at ARM, before any room exists or snapshot is pushed, so every
   * client sees the same result (spec 6.3). Two independent options:
   *
   * - participants 'automatic': the authored group is the POOL. Online,
   *   signed-in stations are dealt into balanced groups (extra groups take
   *   the session's free 1-6 slots); everyone else is dropped from the session.
   * - chairman 'automatic': one member per group is made chairman
   *   ('random', or the first seat for 'rotate').
   *
   * Everything is written back to the session record (SessionMember rows), so
   * the teacher console shows who was picked and can override before Start.
   */
  async prepareOnArm(sessionId: string, actorId: string): Promise<void> {
    const authored = await this.loadRoundTableGroups(sessionId);
    if (authored.length === 0) return;
    const used = new Set((await this.prisma.sessionGroup.findMany({ where: { sessionId }, select: { index: true } })).map((g) => g.index));

    for (const grp of authored) {
      const config = zRoundTableConfig.parse(grp.activity?.config);
      if (config.participantAssignment !== 'automatic') continue;
      const eligible = grp.members
        .filter((m) => this.presence.isOnline(m.stationId) && m.station.currentUserId)
        .map((m) => m.stationId);
      const free = Array.from({ length: MAX_SESSION_GROUPS }, (_, i) => i + 1).filter((i) => !used.has(i));
      let chunks: string[][];
      try {
        chunks = splitIntoGroups(eligible, config.targetGroupSize ?? 4, 1 + free.length);
      } catch (err) {
        if (err instanceof AssignmentError) throw new BadRequestException(`Group ${grp.index}: ${err.message}`);
        throw err;
      }
      await this.prisma.$transaction(async (tx) => {
        // Ineligible stations and those dealt to a new group leave this one.
        await tx.sessionMember.deleteMany({ where: { groupId: grp.id, stationId: { notIn: chunks[0]! } } });
        await tx.sessionMember.updateMany({ where: { groupId: grp.id }, data: { role: SessionRole.MEMBER } });
        for (let i = 1; i < chunks.length; i++) {
          const index = free[i - 1]!;
          await tx.sessionGroup.create({
            data: {
              sessionId,
              index,
              members: { create: chunks[i]!.map((stationId) => ({ stationId, role: SessionRole.MEMBER })) },
              activity: { create: { type: ActivityType.ROUND_TABLE, config: grp.activity!.config as object } },
            },
          });
          used.add(index);
        }
      });
    }

    const summary = [];
    for (const grp of await this.loadRoundTableGroups(sessionId)) {
      const config = zRoundTableConfig.parse(grp.activity?.config);
      const seats = grp.members.map((m) => ({ stationId: m.stationId, seatNo: m.station.seatNo }));
      if (config.chairmanAssignment === 'automatic' && seats.length > 0) {
        const chairman = pickChairman(seats, (id) => this.presence.isOnline(id), config.chairmanStrategy);
        await this.prisma.$transaction([
          this.prisma.sessionMember.updateMany({ where: { groupId: grp.id }, data: { role: SessionRole.MEMBER } }),
          this.prisma.sessionMember.updateMany({ where: { groupId: grp.id, stationId: chairman }, data: { role: SessionRole.CHAIRMAN } }),
        ]);
        summary.push({ groupId: grp.id, index: grp.index, members: seats.map((s) => s.stationId), chairmanStationId: chairman });
      }
    }
    if (summary.length > 0) {
      await this.audit.log({ actorId, action: 'round_table.auto_assign', detail: { sessionId, groups: summary } });
    }
  }
}
