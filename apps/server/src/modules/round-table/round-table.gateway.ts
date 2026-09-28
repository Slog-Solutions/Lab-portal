import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { CONTROL_NAMESPACE, roundTableDashRoom } from '@lab/shared/events';
import { zRtChairSpeaking, zRtGrantPayload, zRtGroupRef, zRtWatchPayload } from '@lab/shared';
import type { JwtPayload } from '../auth/auth.service';
import { RoundTableService } from './round-table.service';

interface AuthedSocket extends Socket {
  data: { auth?: { kind: 'station'; stationId: string } | { kind: 'user'; user: JwtPayload } };
}

/**
 * The Round Table half of the /control namespace (Ser 3). It shares the
 * namespace — and therefore `socket.data.auth`, which ControlGateway sets on
 * connect/hello — with ControlGateway, but lives in its own module so the
 * floor service can depend on ControlGateway without a cycle.
 *
 * Security: the caller is ALWAYS `socket.data.auth.stationId`. A `stationId`
 * inside a payload is only ever the target of a grant; it is never read as
 * "who is asking". A payload that fails its schema is dropped silently, and
 * a rule violation comes back to the caller only, as `rt:error`.
 */
@WebSocketGateway({ namespace: CONTROL_NAMESPACE, cors: { origin: true, credentials: true } })
export class RoundTableGateway {
  private readonly logger = new Logger(RoundTableGateway.name);

  constructor(private readonly roundTable: RoundTableService) {}

  private async run(socket: AuthedSocket, groupId: string, action: (stationId: string) => Promise<void>): Promise<void> {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    try {
      await action(auth.stationId);
    } catch (err) {
      socket.emit('rt:error', { groupId, message: (err as Error).message });
    }
  }

  @SubscribeMessage('rt:requestMic')
  async requestMic(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const ref = zRtGroupRef.safeParse(body);
    if (ref.success) await this.run(socket, ref.data.groupId, (id) => this.roundTable.requestMic(id, ref.data));
  }

  @SubscribeMessage('rt:cancelRequest')
  async cancelRequest(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const ref = zRtGroupRef.safeParse(body);
    if (ref.success) await this.run(socket, ref.data.groupId, (id) => this.roundTable.cancelRequest(id, ref.data));
  }

  @SubscribeMessage('rt:grantFloor')
  async grantFloor(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const p = zRtGrantPayload.safeParse(body);
    if (p.success) await this.run(socket, p.data.groupId, (id) => this.roundTable.grantFloor(id, p.data, p.data.stationId));
  }

  @SubscribeMessage('rt:revokeFloor')
  async revokeFloor(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const ref = zRtGroupRef.safeParse(body);
    if (ref.success) await this.run(socket, ref.data.groupId, (id) => this.roundTable.revokeFloor(id, ref.data));
  }

  @SubscribeMessage('rt:yieldFloor')
  async yieldFloor(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const ref = zRtGroupRef.safeParse(body);
    if (ref.success) await this.run(socket, ref.data.groupId, (id) => this.roundTable.yieldFloor(id, ref.data));
  }

  @SubscribeMessage('rt:sync')
  async sync(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const ref = zRtGroupRef.safeParse(body);
    if (ref.success) await this.run(socket, ref.data.groupId, (id) => this.roundTable.sync(id, ref.data));
  }

  @SubscribeMessage('rt:chairSpeaking')
  async chairSpeaking(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const p = zRtChairSpeaking.safeParse(body);
    if (p.success) await this.run(socket, p.data.groupId, (id) => this.roundTable.chairSpeaking(id, p.data, p.data.speaking));
  }

  /** A teacher/admin dashboard subscribes to one session's floors. */
  @SubscribeMessage('rt:watch')
  async watch(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const auth = socket.data.auth;
    const p = zRtWatchPayload.safeParse(body);
    if (auth?.kind !== 'user' || !p.success) return;
    try {
      await this.roundTable.assertSessionAccess(auth.user, p.data.sessionId);
    } catch (err) {
      this.logger.debug(`rt:watch refused for ${auth.user.sub}: ${(err as Error).message}`);
      return;
    }
    void socket.join(roundTableDashRoom(p.data.sessionId));
    for (const floor of this.roundTable.floorsForSession(p.data.sessionId)) socket.emit('rt:floor', floor);
  }

  @SubscribeMessage('rt:unwatch')
  unwatch(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): void {
    const p = zRtWatchPayload.safeParse(body);
    if (p.success) void socket.leave(roundTableDashRoom(p.data.sessionId));
  }
}
