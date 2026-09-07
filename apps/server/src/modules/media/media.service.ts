import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { BROADCAST_ROOM } from '@lab/shared/events';
import type { EnvConfig } from '../../config/env.validation';

export type StationMediaRole = 'TEACHER' | 'STUDENT';

/**
 * LiveKit integration (design doc §2.2, §2.5). Two-plane room model:
 * - `lab:broadcast` — permanent, all 41 stations, teacher-only publish.
 * - per-group rooms — created/destroyed with the session; isolation is
 *   the JWT `room` grant, never a client-side subscription rule.
 *
 * Tokens are ALWAYS minted server-side. `at.toJwt()` is async in SDK v2
 * — a documented, very common bug to get wrong (design doc §2.5).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly roomService: RoomServiceClient;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private broadcastRoomEnsured = false;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const url = this.config.get('LIVEKIT_URL', { infer: true });
    this.apiKey = this.config.get('LIVEKIT_API_KEY', { infer: true });
    this.apiSecret = this.config.get('LIVEKIT_API_SECRET', { infer: true });
    // RoomServiceClient wants http(s), not ws(s) — LiveKit's REST admin
    // API and the WS media endpoint share a port but not a scheme.
    const httpUrl = url.replace(/^ws/, 'http');
    this.roomService = new RoomServiceClient(httpUrl, this.apiKey, this.apiSecret);
  }

  /** Idempotent — safe to call on every session arm; only creates once. */
  async ensureBroadcastRoom(): Promise<void> {
    if (this.broadcastRoomEnsured) return;
    await this.ensureRoom(BROADCAST_ROOM);
    this.broadcastRoomEnsured = true;
  }

  async ensureRoom(name: string): Promise<void> {
    try {
      await this.roomService.createRoom({ name, emptyTimeout: 6 * 60 * 60, maxParticipants: 45 });
    } catch (err) {
      // LiveKit's createRoom is idempotent server-side in practice, but
      // guard explicitly in case a version throws on an existing room.
      this.logger.debug(`ensureRoom(${name}) — room likely already exists: ${(err as Error).message}`);
    }
  }

  async deleteRoom(name: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(name);
    } catch (err) {
      this.logger.warn(`deleteRoom(${name}) failed (may already be gone): ${(err as Error).message}`);
    }
  }

  /**
   * Mints a token for a station joining `room`. Students get mic-only
   * publish (design doc §2.5 table) — screen-share is granted separately
   * via promoteScreenShare, never by default. `hidden: true` for the
   * teacher's covert-listen mode is layered on by the caller.
   */
  async mintToken(params: {
    stationId: string;
    displayName: string;
    room: string;
    role: StationMediaRole;
    hidden?: boolean;
  }): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `st:${params.stationId}`,
      name: params.displayName,
      ttl: '4h',
      metadata: JSON.stringify({ role: params.role }),
    });
    at.addGrant({
      roomJoin: true,
      room: params.room,
      canPublish: true,
      canPublishSources:
        params.role === 'TEACHER'
          ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
          : [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      hidden: params.hidden ?? false,
    });
    return at.toJwt();
  }

  /** Server-granted screen-share promotion (design doc §2.2) — revoking
   * canPublish auto-unpublishes the track, per LiveKit's documented behavior. */
  async promoteScreenShare(room: string, stationId: string): Promise<void> {
    await this.roomService.updateParticipant(room, `st:${stationId}`, undefined, {
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      canSubscribe: true,
    });
  }

  async revokeScreenShare(room: string, stationId: string): Promise<void> {
    await this.roomService.updateParticipant(room, `st:${stationId}`, undefined, {
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
    });
  }
}
