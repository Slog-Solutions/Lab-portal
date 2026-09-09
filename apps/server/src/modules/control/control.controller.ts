import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CommandType, StationLifecycle, UserRole, type StationStatusRow } from '@lab/shared';
import { BROADCAST_ROOM, controlRoom, mediaRoomForActivity } from '@lab/shared/events';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LockService } from './lock.service';
import { CommandsService } from './commands.service';
import { SessionStateService } from './session-state.service';
import { ControlGateway } from './control.gateway';
import { PresenceService } from './presence.service';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import { StationsService } from '../stations/stations.service';

const zTarget = z.union([
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('session'), sessionId: z.string() }),
  z.object({ kind: z.literal('group'), groupId: z.string() }),
  z.object({ kind: z.literal('stations'), stationIds: z.array(z.string()) }),
  z.object({ kind: z.literal('seats'), seats: z.array(z.number().int()) }),
]);

const zLockDto = z.object({ target: zTarget, screen: z.boolean(), input: z.boolean(), message: z.string().optional() });
const zUnlockDto = z.object({ target: zTarget });
const zTargetOnlyDto = z.object({ target: zTarget });
const zLaunchProgramDto = z.object({ target: zTarget, programId: z.string(), args: z.array(z.string()).optional() });
const zOpenUrlDto = z.object({ target: zTarget, url: z.string().url() });
const zMessageDto = z.object({ target: zTarget, text: z.string().min(1), severity: z.enum(['info', 'warning']) });
const zPromoteDto = z.object({ stationId: z.string(), room: z.string().default(BROADCAST_ROOM) });
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
    private readonly commands: CommandsService,
    private readonly sessionState: SessionStateService,
    private readonly gateway: ControlGateway,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly stations: StationsService,
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
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
  async statusBoard(): Promise<StationStatusRow[]> {
    const rows = await this.stations.listStatusBoard();
    return rows.map((row) => {
      const patch = this.presence.toStatusPatch(row.stationId);
      const online = this.presence.isOnline(row.stationId);
      return {
        ...row,
        lifecycle: online ? patch.lifecycle! : StationLifecycle.OFFLINE,
        lock: online ? (patch.lock ?? null) : null,
        lastSeenAt: online ? (patch.lastSeenAt ?? row.lastSeenAt) : row.lastSeenAt,
        ip: online ? (patch.ip ?? row.ip) : row.ip,
      };
    });
  }

  /** Lock is a lease held server-side and kept alive by ControlGateway's
   * 15s heartbeat (design doc §3.3) — this endpoint just sets the intent. */
  @Post('lock')
  async lock(@Body(new ZodValidationPipe(zLockDto)) dto: z.infer<typeof zLockDto>, @CurrentUser() user: JwtPayload) {
    const stationIds = await this.resolveAndPush(dto.target, async (stationId) => {
      this.locks.lock(stationId, { screen: dto.screen, input: dto.input, message: dto.message });
    });
    await this.audit.log({ actorId: user.sub, action: 'control.lock', detail: { target: dto.target, stationIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  @Post('unlock')
  async unlock(@Body(new ZodValidationPipe(zUnlockDto)) dto: z.infer<typeof zUnlockDto>, @CurrentUser() user: JwtPayload) {
    const stationIds = await this.resolveAndPush(dto.target, async (stationId) => {
      this.locks.unlock(stationId);
    });
    await this.audit.log({ actorId: user.sub, action: 'control.unlock', detail: { target: dto.target, stationIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  @Post('shutdown')
  async shutdown(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.SHUTDOWN, {});
    await this.audit.log({ actorId: user.sub, action: 'control.shutdown', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('restart')
  async restart(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.RESTART, {});
    await this.audit.log({ actorId: user.sub, action: 'control.restart', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('wake')
  async wake(@Body(new ZodValidationPipe(zTargetOnlyDto)) dto: z.infer<typeof zTargetOnlyDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.WAKE, {});
    await this.audit.log({ actorId: user.sub, action: 'control.wake', detail: { target: dto.target } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('launch-program')
  async launchProgram(@Body(new ZodValidationPipe(zLaunchProgramDto)) dto: z.infer<typeof zLaunchProgramDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.LAUNCH_PROGRAM, {
      programId: dto.programId,
      args: dto.args,
    });
    await this.audit.log({ actorId: user.sub, action: 'control.launch_program', detail: { target: dto.target, programId: dto.programId } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('open-url')
  async openUrl(@Body(new ZodValidationPipe(zOpenUrlDto)) dto: z.infer<typeof zOpenUrlDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.OPEN_URL, { url: dto.url });
    await this.audit.log({ actorId: user.sub, action: 'control.open_url', detail: { target: dto.target, url: dto.url } });
    return { ok: true, commandCount: envelopes.length };
  }

  @Post('message')
  async message(@Body(new ZodValidationPipe(zMessageDto)) dto: z.infer<typeof zMessageDto>, @CurrentUser() user: JwtPayload) {
    const envelopes = await this.commands.send(dto.target, CommandType.MESSAGE, { text: dto.text, severity: dto.severity });
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
    const envelopes = await this.commands.send(dto.target, CommandType.PUSH_FILE, {
      assetId: dto.assetId,
      destinationHint: dto.destinationHint,
    });
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

  /** Grants a student's screen into lab:broadcast so the whole class can
   * see it (design doc §2.2 "promoted student's screen"). */
  @Post('promote-screen')
  async promoteScreen(@Body(new ZodValidationPipe(zPromoteDto)) dto: z.infer<typeof zPromoteDto>, @CurrentUser() user: JwtPayload) {
    await this.media.promoteScreenShare(dto.room, dto.stationId);
    await this.audit.log({ actorId: user.sub, stationId: dto.stationId, action: 'control.promote_screen', detail: { room: dto.room } });
    return { ok: true };
  }

  @Post('revoke-screen')
  async revokeScreen(@Body(new ZodValidationPipe(zPromoteDto)) dto: z.infer<typeof zPromoteDto>, @CurrentUser() user: JwtPayload) {
    await this.media.revokeScreenShare(dto.room, dto.stationId);
    await this.audit.log({ actorId: user.sub, stationId: dto.stationId, action: 'control.revoke_screen', detail: { room: dto.room } });
    return { ok: true };
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
    const room = controlRoom(stationId);
    await this.media.ensureRoom(room);
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
    const group = await this.prisma.sessionGroup.findUnique({ where: { id: groupId }, include: { activity: true } });
    if (!group) throw new NotFoundException('Group not found');
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
    const room = controlRoom(stationId);
    this.gateway.stopRemoteControl(stationId, room);
    await this.media.deleteRoom(room);
    await this.audit.log({ actorId: user.sub, stationId, action: 'control.remote_control.stop', detail: { room } });
    return { ok: true };
  }

  private async setEnabled(target: z.infer<typeof zTargetOnlyDto>['target'], enabled: boolean, user: JwtPayload) {
    const stationIds = await this.resolveAndPush(target, (stationId) => this.stations.setEnabled(stationId, enabled));
    await this.audit.log({ actorId: user.sub, action: enabled ? 'control.enable' : 'control.disable', detail: { target, stationIds } });
    return { ok: true, stationCount: stationIds.length };
  }

  /** Resolves a target to stationIds, applies `apply` to each, then
   * pushes a fresh snapshot so the effect (lock/unlock/enable) is
   * visible immediately rather than waiting for the next reconnect.
   * Deliberately does NOT go through CommandsService.send — applying a
   * lock or an enabled flag is not an imperative one-shot command with
   * its own envelope/ack/redelivery semantics, it is state the next
   * snapshot already carries. */
  private async resolveAndPush(
    target: z.infer<typeof zTargetOnlyDto>['target'],
    apply: (stationId: string) => Promise<void> | void,
  ): Promise<string[]> {
    const stationIds = await this.commands.resolveTargetToStationIds(target);
    for (const stationId of stationIds) {
      await apply(stationId);
      const snapshot = await this.sessionState.getDesiredState(stationId);
      this.gateway.pushSnapshot(stationId, snapshot);
    }
    return stationIds;
  }
}
