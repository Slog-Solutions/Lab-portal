import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, TrackSource, TrackType, type ParticipantInfo } from 'livekit-server-sdk';
import { BROADCAST_ROOM, translatorIdentity } from '@lab/shared/events';
import type { EnvConfig } from '../../config/env.validation';

/** How long a room outlives both its last participant leaving and never
 * being joined at all. A class runs for hours and the room must survive
 * the gaps between them. */
const ROOM_TIMEOUT_SECONDS = 6 * 60 * 60;

/** Upper bound on how long lab:broadcast can stay missing after LiveKit
 * tears it down before the next snapshot recreates it. */
const ENSURE_RECHECK_MS = 60_000;

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
  private broadcastRoomEnsuredAt = 0;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const url = this.config.get('LIVEKIT_URL', { infer: true });
    this.apiKey = this.config.get('LIVEKIT_API_KEY', { infer: true });
    this.apiSecret = this.config.get('LIVEKIT_API_SECRET', { infer: true });
    // RoomServiceClient wants http(s), not ws(s) — LiveKit's REST admin
    // API and the WS media endpoint share a port but not a scheme.
    this.httpUrl = url.replace(/^ws/, 'http');
    this.roomService = new RoomServiceClient(this.httpUrl, this.apiKey, this.apiSecret);
  }

  /** Idempotent — safe to call on every session arm. Re-verified on a TTL
   * rather than memoized for the life of the process: LiveKit tears a room
   * down a short departureTimeout after its LAST participant leaves, not
   * just when it idles unused, so a once-true flag leaves lab:broadcast
   * permanently 404 as soon as one class ends — every later join fails and
   * a teacher's broadcast silently captures nothing. See ensureRoom's doc
   * comment for why this can't just fire-and-forget. */
  async ensureBroadcastRoom(): Promise<void> {
    if (Date.now() - this.broadcastRoomEnsuredAt < ENSURE_RECHECK_MS) return;
    if (await this.ensureRoom(BROADCAST_ROOM)) this.broadcastRoomEnsuredAt = Date.now();
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
      // departureTimeout matters as much as emptyTimeout: without it LiveKit
      // deletes the room ~20s after the last participant leaves, which is how
      // lab:broadcast kept vanishing between classes.
      await this.roomService.createRoom({
        name,
        emptyTimeout: ROOM_TIMEOUT_SECONDS,
        departureTimeout: ROOM_TIMEOUT_SECONDS,
        maxParticipants: 45,
      });
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
   * A token for a SERVER-SIDE service participant — currently only the
   * translator (services/translator), which joins a class broadcast room,
   * subscribes to the teacher's mic and publishes one audio track per
   * target language plus captions on the data channel.
   *
   * Three deliberate differences from mintToken:
   * - `hidden: false`. A hidden participant's tracks are invisible to
   *   everyone else, so students could never subscribe to the translation
   *   — the opposite of the teacher's covert-listen token.
   * - Only MICROPHONE in canPublishSources. The translated audio IS a mic
   *   source as far as LiveKit is concerned; granting screen-share to a
   *   service that never shares a screen is an unused right.
   * - A longer TTL than a station's 4h. A class can outlive it otherwise,
   *   and unlike a station the translator has no snapshot loop handing it
   *   a fresh token — it would have to be torn down and rebuilt mid-class.
   */
  async mintServiceToken(params: { scopeId: string; room: string; displayName?: string; ttl?: string }): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: translatorIdentity(params.scopeId),
      name: params.displayName ?? 'Live translation',
      ttl: params.ttl ?? '12h',
      metadata: JSON.stringify({ role: 'SERVICE' }),
    });
    at.addGrant({
      roomJoin: true,
      room: params.room,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      hidden: false,
    });
    return at.toJwt();
  }

  /**
   * A listen-only token for a Translation Lab test room — the teacher's
   * own browser auditioning a test run. canPublish is false throughout:
   * the audio under test is published by the translator from the uploaded
   * file, so a publish right here would only risk the teacher's live mic
   * leaking into a room they are monitoring on speakers.
   */
  async mintListenerToken(params: { identity: string; displayName: string; room: string }): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: params.identity,
      name: params.displayName,
      ttl: '2h',
      metadata: JSON.stringify({ role: 'STUDENT' }),
    });
    at.addGrant({
      roomJoin: true,
      room: params.room,
      canPublish: false,
      canPublishSources: [],
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
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
