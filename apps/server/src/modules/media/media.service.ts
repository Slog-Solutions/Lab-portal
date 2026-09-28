import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, TrackSource, TrackType, type ParticipantInfo } from 'livekit-server-sdk';
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
  private readonly httpUrl: string;
  private broadcastRoomEnsured = false;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const url = this.config.get('LIVEKIT_URL', { infer: true });
    this.apiKey = this.config.get('LIVEKIT_API_KEY', { infer: true });
    this.apiSecret = this.config.get('LIVEKIT_API_SECRET', { infer: true });
    // RoomServiceClient wants http(s), not ws(s) — LiveKit's REST admin
    // API and the WS media endpoint share a port but not a scheme.
    this.httpUrl = url.replace(/^ws/, 'http');
    this.roomService = new RoomServiceClient(this.httpUrl, this.apiKey, this.apiSecret);
  }

  /** Idempotent — safe to call on every session arm; only memoizes once
   * ensureRoom has confirmed (not merely attempted) room creation. See
   * ensureRoom's doc comment for why this can't just fire-and-forget. */
  async ensureBroadcastRoom(): Promise<void> {
    if (this.broadcastRoomEnsured) return;
    this.broadcastRoomEnsured = await this.ensureRoom(BROADCAST_ROOM);
  }

  /**
   * Returns whether `name` is known to exist in LiveKit. Deliberately
   * swallows errors rather than throwing — this sits behind
   * getDesiredState (session-state.service.ts), the single code path
   * behind every station snapshot, including lock/restart/shutdown; an
   * unreachable LiveKit must degrade the media plane, not the whole
   * control plane.
   *
   * createRoom failing is ambiguous by itself — "already exists" and
   * "LiveKit is unreachable" both throw — so on failure we ask LiveKit
   * directly via listRooms rather than pattern-matching the error
   * message. This matters because room.auto_create is false
   * (infra/livekit/livekit.yaml): silently treating an unreachable
   * LiveKit as "room ensured" (the previous behavior) permanently wedges
   * lab:broadcast for the life of the process, since ensureBroadcastRoom
   * only ever calls this once per boot.
   */
  async ensureRoom(name: string): Promise<boolean> {
    try {
      await this.roomService.createRoom({ name, emptyTimeout: 6 * 60 * 60, maxParticipants: 45 });
      return true;
    } catch (err) {
      try {
        const rooms = await this.roomService.listRooms([name]);
        if (rooms.length > 0) return true;
      } catch {
        // LiveKit itself is unreachable — fall through to the warning below.
      }
      this.logger.warn(`ensureRoom(${name}) failed — is LiveKit running at ${this.httpUrl}? ${(err as Error).message}`);
      return false;
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

  /**
   * The student side of a `ctrl:<stationId>` remote-control room (design
   * doc §3.4) — NOT the same grant as mintToken's generic STUDENT role,
   * which is deliberately mic-only for the broadcast/group rooms. Here
   * the station must publish its own screen (that is the entire point:
   * the teacher needs to see it), so this is its own grant shape rather
   * than a role variant of mintToken. Caught live in this build: reusing
   * mintToken's STUDENT branch for this room produced a token LiveKit
   * correctly rejected with "insufficient permissions to publish".
   */
  async mintRemoteControlStudentToken(stationId: string, displayName: string, room: string): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `st:${stationId}`,
      name: displayName,
      ttl: '4h',
      metadata: JSON.stringify({ role: 'STUDENT' }),
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  /**
   * Ser 8 Conference Interpreting (Phase 5): one shared room per session
   * (see `mediaRoomForActivity`/`interpretingRoom`) where INTERPRETER and
   * DELEGATE publish their own mic — the delegate IS the floor channel,
   * an interpreter's mic IS their language channel — and OBSERVER is
   * subscribe-only (an observer only ever listens; letting them publish
   * would just be an unused grant, but it's also a real information
   * boundary: nothing distinguishes "observer" from "delegate" to other
   * participants except which tracks exist to select between). Every
   * role gets `hidden: false` and `canSubscribe: true` — channel
   * selection (which published track to actually listen to) is a
   * client-side decision (see ConferenceInterpretingActivity), not a
   * server-enforced one, same posture as every other group room.
   */
  async mintInterpretingToken(params: {
    stationId: string;
    displayName: string;
    room: string;
    canPublishMic: boolean;
  }): Promise<string> {
    return this.mintMicGatedToken({ ...params, role: 'STUDENT' });
  }

  /**
   * A subscribe-everything token whose mic-publish right is decided by the
   * caller. Used where the SERVER, not the client, owns who may talk: the
   * interpreting room (role-based) and Round Table (floor-based, see
   * RoundTableService — those tokens are minted with canPublishMic:false
   * and the floor service grants the right in place with setMicPermission,
   * so a reconnect can never briefly hand a member an open mic). Never
   * hidden: monitoring is never silent (Round Table spec D4).
   */
  async mintMicGatedToken(params: {
    stationId: string;
    displayName: string;
    room: string;
    canPublishMic: boolean;
    role: StationMediaRole;
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
      canPublish: params.canPublishMic,
      canPublishSources: params.canPublishMic ? [TrackSource.MICROPHONE] : [],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  /**
   * Changes one participant's mic-publish right in place. updateParticipant
   * REPLACES the whole permission set, so every field a mic-gated token
   * grants is passed again (leaving canPublishData out would silently
   * reset it). Revoking canPublish makes LiveKit unpublish the track
   * server-side — that is what actually silences the seat.
   */
  async setMicPermission(room: string, identity: string, allowed: boolean): Promise<void> {
    await this.roomService.updateParticipant(room, identity, undefined, {
      canPublish: allowed,
      canPublishSources: allowed ? [TrackSource.MICROPHONE] : [],
      canSubscribe: true,
      canPublishData: true,
    });
  }

  /** Throws if LiveKit is unreachable; a missing room reads as empty. */
  async listParticipants(room: string): Promise<ParticipantInfo[]> {
    try {
      return await this.roomService.listParticipants(room);
    } catch (err) {
      if (/not found|does not exist/i.test((err as Error).message)) return [];
      throw err;
    }
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.roomService.removeParticipant(room, identity);
    } catch (err) {
      this.logger.debug(`removeParticipant(${room}, ${identity}) failed (may already be gone): ${(err as Error).message}`);
    }
  }

  /** Server-side mute of every published mic track this participant has. */
  async muteMicTracks(room: string, participant: ParticipantInfo): Promise<void> {
    for (const track of participant.tracks) {
      if (track.type !== TrackType.AUDIO || track.muted) continue;
      try {
        await this.roomService.mutePublishedTrack(room, participant.identity, track.sid, true);
      } catch (err) {
        this.logger.debug(`mutePublishedTrack failed for ${participant.identity}: ${(err as Error).message}`);
      }
    }
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
