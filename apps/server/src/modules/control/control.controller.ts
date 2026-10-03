import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { CommandType, seatLabel, StationLifecycle, UserRole, type StationStatusRow } from '@lab/shared';
import { BROADCAST_ROOM, classBroadcastRoom, controlRoom, mediaRoomForActivity } from '@lab/shared/events';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LockService } from './lock.service';
import { RemoteControlSessionService } from './remote-control-session.service';
import { ScreenShareService } from './screen-share.service';
import { CommandsService } from './commands.service';
import { SessionStateService } from './session-state.service';
import { ControlGateway } from './control.gateway';
import { PresenceService } from './presence.service';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import { StationsService } from '../stations/stations.service';
import { ClassAccessService } from '../classroom/class-access.service';

const zTarget = z.union([
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('session'), sessionId: z.string() }),
  z.object({ kind: z.literal('group'), groupId: z.string() }),
  z.object({ kind: z.literal('stations'), stationIds: z.array(z.string()) }),
  z.object({ kind: z.literal('seats'), seats: z.array(z.number().int()) }),
]);

const zLockDto = z.object({
  target: zTarget,
  mode: z.enum(['soft', 'windows']).default('soft'),
  screen: z.boolean(),
  input: z.boolean(),
  message: z.string().optional(),
});
const zUnlockDto = z.object({ target: zTarget });
const zTargetOnlyDto = z.object({ target: zTarget });
const zLaunchProgramDto = z.object({ target: zTarget, programId: z.string(), args: z.array(z.string()).optional() });
const zOpenUrlDto = z.object({ target: zTarget, url: z.string().url() });
const zMessageDto = z.object({ target: zTarget, text: z.string().min(1), severity: z.enum(['info', 'warning']) });
const zPromoteDto = z.object({ stationId: z.string(), mic: z.boolean().default(false) });
const zRevokeDto = z.object({ stationId: z.string() });
const zChangeSeatDto = z.object({ seatNo: z.number().int().min(1).max(41) });
const zPushFileDto = z.object({
  target: zTarget,
  assetId: z.string(),
  destinationHint: z.enum(['desktop', 'downloads']).default('downloads'),
});

/**
 * Classroom control surface (Annexure-I Ser 1). Every endpoint here is a
 * privileged, audited action — teacher/admin only, and every call writes
 * AuditService before or after the effect (design doc §3.6: "this is a
 * remote-control backdoor by construction, so it is built as one").
 */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('control')
export class ControlController {
  constructor(
    private readonly locks: LockService,
    private readonly remoteControlSessions: RemoteControlSessionService,
    private readonly screenShares: ScreenShareService,
    private readonly commands: CommandsService,
    private readonly sessionState: SessionStateService,
    private readonly gateway: ControlGateway,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly stations: StationsService,
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
    private readonly classAccess: ClassAccessService,
  ) {}

  /**
   * The REST equivalent of the socket `lab:status`/`lab:status:delta`
   * events — same merge of DB truth + live PresenceService state, for
   * the dashboard's first paint before its socket connects. This
   * replaced a real bug: StationsController's old status-board endpoint
   * returned DB rows with lock/mic/lifecycle hardcoded to placeholder
   * values, never actually reading PresenceService (verified live: a
   * locked station's REST status showed lock:null while its Socket.IO
   * snapshot correctly carried the lock — see build session notes).
   */
  @Get('status-board')
  async statusBoard(@CurrentUser() user: JwtPayload): Promise<StationStatusRow[]> {
    const rows = await this.stations.listStatusBoard();
    const merged = rows.map((row) => {
      const patch = this.presence.toStatusPatch(row.stationId);
      const online = this.presence.isOnline(row.stationId);
      return {
        ...row,
        lifecycle: online ? patch.lifecycle! : StationLifecycle.OFFLINE,
        lock: online ? (patch.lock ?? null) : null,
        lastSeenAt: online ? (patch.lastSeenAt ?? row.lastSeenAt) : row.lastSeenAt,
        ip: online ? (patch.ip ?? row.ip) : row.ip,
        screenSharing: online ? (patch.screenSharing ?? false) : false,
      };
    });
    // A TEACHER sees only the PCs in their active class — an ADMIN still
    // sees everything (design decision: "admins still see everything").
    const controllable = await this.classAccess.controllableStationIds(user);
    return controllable === 'all' ? merged : merged.filter((r) => controllable.includes(r.stationId));
  }

  /** Lock is a lease held server-side and kept alive by ControlGateway's
   * 15s heartbeat (design doc §3.3) — this endpoint just sets the intent. */
  @Post('lock')
  async lock(@Body(new ZodValidationPipe(zLockDto)) dto: z.infer<typeof zLockDto>, @CurrentUser() user: JwtPayload) {
    const stationIds = await this.resolveAndPush(dto.target, user, async (stationId) => {
      await this.locks.lock(stationId, { mode: dto.mode, screen: dto.screen, input: dto.input, message: dto.message, lockedBy: user.sub });
    });
    const userIds = this.affectedUserIds(stationIds);
    await this.audit.log({ actorId: user.sub, action: 'control.lock', detail: { target: dto.target, mode: dto.mode, screen: dto.screen, input: dto.input, stationIds, userIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  @Post('unlock')
  async unlock(@Body(new ZodValidationPipe(zUnlockDto)) dto: z.infer<typeof zUnlockDto>, @CurrentUser() user: JwtPayload) {
    const stationIds = await this.resolveAndPush(dto.target, user, async (stationId) => {
      await this.locks.unlock(stationId);
    });
    // Unlock doesn't touch seat occupancy, so this is just as accurate
    // read after the fact as before it — same pattern as lock() above.
    const userIds = this.affectedUserIds(stationIds);
    await this.audit.log({ actorId: user.sub, action: 'control.unlock', detail: { target: dto.target, stationIds, userIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  /** Which student(s) — if any — currently sit at these stations, for the
   * audit log's `userIds` (falls out of LockService's own seat-occupant
   * tracking, unaffected by the lock/unlock that just ran). */
  private affectedUserIds(stationIds: string[]): string[] {
    const userIds = stationIds.map((id) => this.locks.getSeatOccupant(id)).filter((id): id is string => id !== null);
    return Array.from(new Set(userIds));
  }

  @Post('shutdown')
  async shutdown(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.SHUTDOWN, {}, user);
    await this.audit.log({ actorId: user.sub, action: 'control.shutdown', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('restart')
  async restart(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.RESTART, {}, user);
    await this.audit.log({ actorId: user.sub, action: 'control.restart', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('wake')
  async wake(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.WAKE, {}, user);
    await this.audit.log({ actorId: user.sub, action: 'control.wake', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('launch-program')
  async launchProgram(@Body(new ZodValidationPipe(zLaunchProgramDto)) dto: z.infer<typeof zLaunchProgramDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(
      dto.target,
      CommandType.LAUNCH_PROGRAM,
      { programId: dto.programId, args: dto.args },
      user,
    );
    await this.audit.log({ actorId: user.sub, action: 'control.launch_program', detail: { target: dto.target, programId: dto.programId } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('open-url')
  async openUrl(@Body(new ZodValidationPipe(zOpenUrlDto)) dto: z.infer<typeof zOpenUrlDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.OPEN_URL, { url: dto.url }, user);
    await this.audit.log({ actorId: user.sub, action: 'control.open_url', detail: { target: dto.target, url: dto.url } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('message')
  async message(@Body(new ZodValidationPipe(zMessageDto)) dto: z.infer<typeof zMessageDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.MESSAGE, { text: dto.text, severity: dto.severity }, user);
    await this.audit.log({ actorId: user.sub, action: 'control.message', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  /** Ser 1 "file functions" — the command envelope + client allowlist
   * already existed (design doc §4.3); this is the missing REST trigger.
   * The station downloads the asset itself, authenticated with its own
   * station token — the server never pushes bytes through the command
   * channel. */
  @Post('push-file')
  async pushFile(@Body(new ZodValidationPipe(zPushFileDto)) dto: z.infer<typeof zPushFileDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(
      dto.target,
      CommandType.PUSH_FILE,
      { assetId: dto.assetId, destinationHint: dto.destinationHint },
      user,
    );
    await this.audit.log({ actorId: user.sub, action: 'control.push_file', detail: { target: dto.target, assetId: dto.assetId } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('enable')
  async enable(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    return this.setEnabled(dto.target, true, user);
  }

  @Post('disable')
  async disable(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    return this.setEnabled(dto.target, false, user);
  }

  /**
   * Spotlights a student's screen to the whole class (Ser 1 "broadcast any
   * student's screen to others" — design doc §2.2 "promoted student's
   * screen"). Publishes into the room the class is ALREADY in (an ADMIN's
   * lab-wide lab:broadcast, or a TEACHER's own classBroadcastRoom — same
   * resolution as MediaController.broadcastToken), because every signed-in
   * student is already connected there with a live subscribe grant;
   * minting a fresh token with a screen grant would be silently ignored —
   * StudentConsole.reconcileRooms only ever connects to rooms it isn't
   * already in. So the server upgrades the station's existing LiveKit
   * publish permissions in place (MediaService.promoteScreenShare) and
   * then tells it to actually start publishing (screen-share:set) — one
   * without the other does nothing.
   *
   * One spotlight per room: promoting a second station first revokes and
   * stops whichever one was presenting (ScreenShareService.set).
   */
  @Post('promote-screen')
  async promoteScreen(@Body(new ZodValidationPipe(zPromoteDto)) dto: z.infer<typeof zPromoteDto>, @CurrentUser() user: JwtPayload) {
    await this.classAccess.assertCanControlStation(user, dto.stationId);
    const room = await this.resolveBroadcastRoom(user);

    if (!(await this.media.ensureRoom(room))) {
      throw new ServiceUnavailableException(
        'Could not reach the class broadcast room — is the LiveKit media server running?',
      );
    }

    const { previousStationId } = this.screenShares.set(room, dto.stationId, dto.mic);
    if (previousStationId) {
      await this.media.revokeScreenShare(room, previousStationId);
      this.gateway.setScreenShare(previousStationId, { room, screen: false, mic: false });
      await this.gateway.sendStatusRow(previousStationId);
    }

    try {
      await this.media.promoteScreenShare(room, dto.stationId);
    } catch {
      // LiveKit throws if the participant isn't actually in `room` — the
      // student isn't signed into this class, or its media connection
      // never came up. Undo the reservation we just took so a failed
      // promote doesn't leave a phantom presenter on the board.
      this.screenShares.clearRoom(room);
      throw new ConflictException(
        "That computer isn't connected to the class yet — the student needs to be signed in.",
      );
    }

    this.gateway.setScreenShare(dto.stationId, { room, screen: true, mic: dto.mic });
    await this.gateway.sendStatusRow(dto.stationId);
    await this.audit.log({ actorId: user.sub, stationId: dto.stationId, action: 'control.promote_screen', detail: { room, mic: dto.mic } });

    const viewerToken = await this.media.mintToken({
      // A distinct identity from the teacher's own `teacher:<sub>` broadcast
      // connection (MediaController.broadcastToken) — two LiveKit
      // connections sharing one identity in the same room evict each
      // other, which would kill the teacher's own broadcast the instant
      // they open this preview.
      stationId: `teacher:${user.sub}:viewer`,
      displayName: `Teacher (${user.serviceNumber})`,
      room,
      role: 'TEACHER',
      hidden: true,
    });
    return { room, viewerToken };
  }

  /** Ends the spotlight — the presenting station's screen (and any
   * presenter mic) stops publishing and its promoted permissions are
   * revoked back to mic-only. */
  @Post('revoke-screen')
  async revokeScreen(@Body(new ZodValidationPipe(zRevokeDto)) dto: z.infer<typeof zRevokeDto>, @CurrentUser() user: JwtPayload) {
    await this.classAccess.assertCanControlStation(user, dto.stationId);
    const room = await this.resolveBroadcastRoom(user);
    await this.media.revokeScreenShare(room, dto.stationId);
    this.screenShares.clearByStation(dto.stationId);
    this.gateway.setScreenShare(dto.stationId, { room, screen: false, mic: false });
    await this.gateway.sendStatusRow(dto.stationId);
    await this.audit.log({ actorId: user.sub, stationId: dto.stationId, action: 'control.revoke_screen', detail: { room } });
    return { ok: true };
  }

  /** Same ADMIN-vs-TEACHER room resolution as MediaController.broadcastToken
   * — kept in sync deliberately rather than shared, since the two callers
   * (mint a viewer token vs. resolve a promote target) diverge just enough
   * that a shared helper would need its own conditional anyway. */
  private async resolveBroadcastRoom(user: JwtPayload): Promise<string> {
    if (user.role === UserRole.ADMIN) return BROADCAST_ROOM;
    const activeClass = await this.classAccess.activeClassForTeacher(user.sub);
    if (!activeClass) {
      throw new ConflictException('Start a class before sharing a student’s screen');
    }
    return classBroadcastRoom(activeClass.id);
  }

  /**
   * Remote control (design doc §3.4): a dedicated ephemeral `ctrl:<id>`
   * room, cryptographically isolated by the JWT `room` grant — only the
   * calling teacher's token names this room, not lab:broadcast, so no
   * other student can ever see or hear this session. This is a
   * remote-control backdoor by construction (design doc §3.6): logged
   * here, and the student-visible indicator is the station's own
   * monitoringIndicator (default on).
   */
  @Post('remote-control/:stationId/start')
  async startRemoteControl(@Param('stationId') stationId: string, @CurrentUser() user: JwtPayload) {
    await this.classAccess.assertCanControlStation(user, stationId);
    const room = controlRoom(stationId);
    if (!(await this.media.ensureRoom(room))) {
      throw new ServiceUnavailableException(
        'Could not create the remote-control room — is the LiveKit media server running?',
      );
    }
    // Reference-counted: ctrl:<stationId> is one room shared by every
    // concurrent "start" for this station (React StrictMode's
    // mount/mount/cleanup among them) — see
    // RemoteControlSessionService's doc comment for why a bare
    // start/stop pair here would let a stale stop delete a room a
    // still-active session needs.
    this.remoteControlSessions.start(stationId);
    const studentToken = await this.media.mintRemoteControlStudentToken(stationId, stationId, room);
    const teacherToken = await this.media.mintToken({
      stationId: `teacher:${user.sub}`,
      displayName: `Teacher (${user.serviceNumber})`,
      room,
      role: 'TEACHER',
      hidden: true,
    });
    this.gateway.startRemoteControl(stationId, room, studentToken);
    await this.audit.log({ actorId: user.sub, stationId, action: 'control.remote_control.start', detail: { room } });
    return { room, teacherToken };
  }

  /**
   * Ser 3 gap this pass closes: "Teacher listens in on any group, can
   * join." Unlike remote-control (which needs the STATION to start
   * publishing its screen), a group's LiveKit room already exists the
   * moment the session is armed and the teacher's own token already
   * grants canSubscribe — so "listening in" needs no coordination with
   * the group's members at all, just a hidden token for whichever room
   * that group's activity actually lives in (mediaRoomForActivity — the
   * same decision SessionsService/SessionStateService make, so a
   * conference-interpreting group's shared session-wide room resolves
   * correctly here too, not just the per-group default).
   */
  @Post('monitor-group/:groupId/start')
  async startGroupMonitor(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    const group = await this.prisma.sessionGroup.findUnique({ where: { id: groupId }, include: { activity: true, members: true } });
    if (!group) throw new NotFoundException('Group not found');
    const memberStationIds = group.members.map((m) => m.stationId);
    const controllableMembers = await this.classAccess.filterControllable(user, memberStationIds);
    if (controllableMembers.length !== memberStationIds.length) {
      throw new ForbiddenException('None of the selected computers are in your class');
    }
    const room = mediaRoomForActivity(group.sessionId, group.id, group.activity?.type ?? '');
    const token = await this.media.mintToken({
      stationId: `teacher:${user.sub}`,
      displayName: `Teacher (${user.serviceNumber})`,
      room,
      role: 'TEACHER',
      hidden: true,
    });
    await this.audit.log({ actorId: user.sub, action: 'control.monitor_group.start', detail: { groupId, room } });
    return { room, token };
  }

  /** Nothing server-side to tear down (the teacher just disconnects its
   * own LiveKit room client) — this exists purely so "stopped listening"
   * is as auditable as "started", matching remote-control's pairing. */
  @Post('monitor-group/:groupId/stop')
  async stopGroupMonitor(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    await this.audit.log({ actorId: user.sub, action: 'control.monitor_group.stop', detail: { groupId } });
    return { ok: true };
  }

  @Post('remote-control/:stationId/stop')
  async stopRemoteControl(@Param('stationId') stationId: string, @CurrentUser() user: JwtPayload) {
    await this.classAccess.assertCanControlStation(user, stationId);
    const room = controlRoom(stationId);
    // Only the stop that brings the count to zero actually tears
    // anything down — see RemoteControlSessionService. A stop that
    // still has a sibling session active is logged (every stop CALL is
    // audited, same as before) but must not stop the student's publish
    // or delete the room out from under the surviving session.
    const isFinalStop = this.remoteControlSessions.stop(stationId);
    if (isFinalStop) {
      this.gateway.stopRemoteControl(stationId, room);
      await this.media.deleteRoom(room);
    }
    await this.audit.log({
      actorId: user.sub,
      stationId,
      action: 'control.remote_control.stop',
      detail: { room, tornDown: isFinalStop },
    });
    return { ok: true };
  }

  /**
   * Admin: give a station a different seat number. A free seat is a plain
   * reassignment; a seat another station already holds swaps the two. Lives
   * here rather than on StationsController because every affected PC must be
   * told its new number right away (station:identity, a fresh snapshot) and
   * the dashboards updated — and that needs ControlGateway/PresenceService.
   */
  @Roles(UserRole.ADMIN)
  @Post('stations/:stationId/seat')
  async changeSeat(
    @Param('stationId') stationId: string,
    @Body(new ZodValidationPipe(zChangeSeatDto)) dto: z.infer<typeof zChangeSeatDto>,
    @CurrentUser() user: JwtPayload,
  ) {
    const station = await this.prisma.station.findUnique({ where: { id: stationId }, select: { seatNo: true } });
    if (!station) throw new NotFoundException('Station not found');
    if (station.seatNo === dto.seatNo) return { ok: true, swappedWithStationId: null };

    const holder = await this.prisma.station.findUnique({ where: { seatNo: dto.seatNo }, select: { id: true } });
    // Swapping with an unnumbered station would leave the other PC with no
    // seat at all — make the admin free the seat deliberately instead.
    if (holder && station.seatNo === null) {
      throw new ConflictException(`Seat ${seatLabel(dto.seatNo)} is taken — pick a free seat for an unassigned station`);
    }
    if (holder) await this.stations.swapSeats(stationId, holder.id, user.sub);
    else await this.stations.assignSeat({ stationId, seatNo: dto.seatNo }, user.sub);

    const moved: Array<[string, number]> = [[stationId, dto.seatNo]];
    if (holder && station.seatNo !== null) moved.push([holder.id, station.seatNo]);
    for (const [id, seatNo] of moved) {
      this.presence.setSeatNo(id, seatNo);
      this.gateway.emitIdentity(id, seatNo);
      this.gateway.pushSnapshot(id, await this.sessionState.getDesiredState(id));
      await this.gateway.sendStatusRow(id);
    }
    return { ok: true, swappedWithStationId: holder?.id ?? null };
  }

  private async setEnabled(target: z.infer<typeof zTargetOnlyDto>['target'], enabled: boolean, user: JwtPayload) {
    const stationIds = await this.resolveAndPush(target, user, (stationId) => this.stations.setEnabled(stationId, enabled));
    await this.audit.log({ actorId: user.sub, action: enabled ? 'control.enable' : 'control.disable', detail: { target, stationIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  /** Resolves a target to stationIds (scoped to `user`'s class — see
   * CommandsService.resolveTargetToStationIds), applies `apply` to each,
   * then pushes a fresh snapshot so the effect (lock/unlock/enable) is
   * visible immediately rather than waiting for the next reconnect.
   * Deliberately does NOT go through CommandsService.send — applying a
   * lock or an enabled flag is not an imperative one-shot command with
   * its own envelope/ack/redelivery semantics, it is state the next
   * snapshot already carries. */
  private async resolveAndPush(
    target: z.infer<typeof zTargetOnlyDto>['target'],
    user: JwtPayload,
    apply: (stationId: string) => Promise<void> | void,
  ): Promise<string[]> {
    const stationIds = await this.commands.resolveTargetToStationIds(target, user);
    for (const stationId of stationIds) {
      await apply(stationId);
      const snapshot = await this.sessionState.getDesiredState(stationId);
      this.gateway.pushSnapshot(stationId, snapshot);
      // Lock/unlock/enable now shows up on the dashboard tile immediately
      // (PresenceService.toStatusPatch reads LockService directly) instead
      // of waiting for the next heartbeat-driven delta.
      await this.gateway.sendStatusRow(stationId);
    }
    return stationIds;
  }
}
