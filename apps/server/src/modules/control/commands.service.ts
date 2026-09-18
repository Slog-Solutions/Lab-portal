import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import {
  CommandType,
  UserRole,
  type CommandAck,
  type CommandEnvelope,
  type CommandTarget,
} from '@lab/shared';
import { stationRoom } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassAccessService } from '../classroom/class-access.service';
import type { JwtPayload } from '../auth/auth.service';
import type { Server } from 'socket.io';

const COMMAND_TTL_MS = 60_000;

/**
 * Imperative, one-shot commands (design doc §4.3): shutdown, restart,
 * launch, open URL, push file, message. Distinct from
 * DesiredStationState, which is declarative/idempotent — these commands
 * must NOT be re-executed on redelivery, so each is held in an outbox
 * until acked or expired, and the client is expected to dedupe by
 * `commandId` (design doc: "ring buffer of the last ~200 applied
 * commandIds").
 */
@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);
  private seq = 0;
  /** stationId -> pending commands, oldest first. */
  private readonly outbox = new Map<string, CommandEnvelope[]>();
  private server?: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly classAccess: ClassAccessService,
  ) {}

  /** ControlGateway hands us its socket.io server once at startup — see
   * control.gateway.ts's constructor. Avoids a circular DI dependency
   * (CommandsService would otherwise need to inject ControlGateway,
   * which itself depends on services in this same module). */
  attachServer(server: Server): void {
    this.server = server;
  }

  /**
   * Public so callers that need the resolved station set WITHOUT
   * issuing a command (e.g. applying a lock, which is not a command
   * envelope at all — see LockService) don't have to duplicate this
   * query logic or, worse, piggyback on an unrelated command type as a
   * side-effecting way to get station IDs.
   *
   * This is the single choke point every targeted control action passes
   * through — `actor` is optional only because a handful of internal
   * callers (SessionsService pushing a post-arm snapshot, etc.) act with
   * system authority, not a specific teacher; every HTTP endpoint on
   * ControlController passes its @CurrentUser() here. For a TEACHER, the
   * resolved set is intersected with their controllable stations — so
   * `kind: 'all'` means "every station in my class", not literally every
   * station in the lab. ADMIN is never filtered.
   */
  async resolveTargetToStationIds(target: CommandTarget, actor?: Pick<JwtPayload, 'sub' | 'role'>): Promise<string[]> {
    const resolved = await this.resolveTarget(target);
    if (!actor || actor.role === UserRole.ADMIN) return resolved;
    const filtered = await this.classAccess.filterControllable(actor, resolved);
    if (filtered.length === 0) {
      throw new ForbiddenException('None of the selected computers are in your class');
    }
    return filtered;
  }

  async send<T = unknown>(
    target: CommandTarget,
    type: CommandType,
    payload: T,
    actor?: Pick<JwtPayload, 'sub' | 'role'>,
  ): Promise<CommandEnvelope<T>[]> {
    const stationIds = await this.resolveTargetToStationIds(target, actor);
    const envelopes: CommandEnvelope<T>[] = stationIds.map((stationId) => {
      const envelope: CommandEnvelope<T> = {
        id: randomUUID(),
        seq: ++this.seq,
        type,
        target: { kind: 'stations', stationIds: [stationId] },
        payload,
        issuedAt: Date.now(),
        expiresAt: Date.now() + COMMAND_TTL_MS,
      };
      const queue = this.outbox.get(stationId) ?? [];
      queue.push(envelope as CommandEnvelope);
      this.outbox.set(stationId, queue);
      this.server?.to(stationRoom(stationId)).emit('command', envelope);
      return envelope;
    });

    if (type === CommandType.WAKE) {
      // WoL targets stations that are, by definition, offline and have
      // no live socket — deliver by magic packet instead of emit above.
      await this.sendWakeOnLan(stationIds);
    }

    return envelopes;
  }

  ack(stationId: string, ack: CommandAck): void {
    const queue = this.outbox.get(stationId);
    if (!queue) return;
    const remaining = queue.filter((c) => c.id !== ack.commandId);
    if (remaining.length !== queue.length) {
      this.outbox.set(stationId, remaining);
    }
  }

  /** Redelivers any unacked, unexpired commands — called on station:hello
   * so a station that reconnects mid-outage doesn't lose a shutdown/launch
   * command that was issued while it was offline. */
  redeliverPending(stationId: string, socketId: string): void {
    const queue = this.outbox.get(stationId);
    if (!queue?.length) return;
    const now = Date.now();
    const live = queue.filter((c) => c.expiresAt > now);
    this.outbox.set(stationId, live);
    for (const envelope of live) {
      this.server?.to(socketId).emit('command', envelope);
    }
  }

  private async resolveTarget(target: CommandTarget): Promise<string[]> {
    switch (target.kind) {
      case 'all': {
        const stations = await this.prisma.station.findMany({ where: { archivedAt: null }, select: { id: true } });
        return stations.map((s) => s.id);
      }
      case 'stations':
        return target.stationIds;
      case 'seats': {
        const stations = await this.prisma.station.findMany({
          where: { seatNo: { in: target.seats }, archivedAt: null },
          select: { id: true },
        });
        return stations.map((s) => s.id);
      }
      case 'session': {
        const members = await this.prisma.sessionMember.findMany({
          where: { group: { sessionId: target.sessionId } },
          select: { stationId: true },
        });
        return members.map((m) => m.stationId);
      }
      case 'group': {
        const members = await this.prisma.sessionMember.findMany({
          where: { groupId: target.groupId },
          select: { stationId: true },
        });
        return members.map((m) => m.stationId);
      }
    }
  }

  private async sendWakeOnLan(stationIds: string[]): Promise<void> {
    const stations = await this.prisma.station.findMany({ where: { id: { in: stationIds } } });
    const socket = dgram.createSocket('udp4');
    socket.bind(() => socket.setBroadcast(true));
    for (const station of stations) {
      const mac = station.macs[0];
      if (!mac) continue;
      const packet = buildMagicPacket(mac);
      socket.send(packet, 9, '255.255.255.255', (err) => {
        if (err) this.logger.warn(`WoL send failed for ${station.hostname} (${mac}): ${err.message}`);
      });
    }
    setTimeout(() => socket.close(), 1000);
  }
}

/** design doc §3.5: 6×0xFF + 16× repeated MAC bytes. */
function buildMagicPacket(mac: string): Buffer {
  const macBytes = mac.split(':').map((b) => parseInt(b, 16));
  return Buffer.concat([Buffer.alloc(6, 0xff), Buffer.from(Array(16).fill(macBytes).flat())]);
}
