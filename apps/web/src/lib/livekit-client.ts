import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

export interface RemoteTrackHandle {
  participantIdentity: string;
  source: Track.Source;
  track: RemoteTrack;
}

export interface LiveKitRoomEvents {
  onTrackSubscribed?: (handle: RemoteTrackHandle) => void;
  onTrackUnsubscribed?: (handle: RemoteTrackHandle) => void;
  onDisconnected?: () => void;
  /** LiveKit data-channel payloads (design doc §3.4 remote-control input
   * replay uses topic REMOTE_CONTROL_DATA_TOPIC from packages/shared). */
  onDataReceived?: (payload: Uint8Array, topic: string | undefined) => void;
}

/**
 * One room connection (design doc §2.2's two-plane model — a station
 * typically holds one of these per entry in
 * DesiredStationState.media.rooms). Deliberately thin: components own
 * what to do with a subscribed track (attach to a <video>/<audio>
 * element); this class only owns the Room lifecycle and re-emits
 * LiveKit's events in the shape callers need.
 *
 * autoSubscribe stays at its default (true) here — the teacher's
 * "pre-connect to every group room with zero subscriptions" optimization
 * (design doc §2.2) is a Phase 2 concern for the multi-group console,
 * not this first broadcast/intercom slice.
 */
export class LiveKitRoomClient {
  readonly room: Room;

  constructor(private readonly events: LiveKitRoomEvents = {}) {
    this.room = new Room({ adaptiveStream: true, dynacast: true });
    this.room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed);
    this.room.on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed);
    this.room.on(RoomEvent.Disconnected, () => this.events.onDisconnected?.());
    this.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => this.events.onDataReceived?.(payload, topic));
  }

  /** Reliable delivery for clicks/keys, unreliable for high-rate mouse
   * moves (design doc §3.4) — callers pass `reliable` explicitly rather
   * than this class guessing from event shape. Accepts the DOM lib's
   * broader `Uint8Array<ArrayBufferLike>` (what TextEncoder.encode()
   * actually returns) — livekit-client's own type is the narrower
   * SharedArrayBuffer-excluding variant (TS 5.7+ split), which
   * TextEncoder output is never actually backed by, so the cast is safe. */
  async publishData(payload: Uint8Array<ArrayBufferLike>, topic: string, reliable: boolean): Promise<void> {
    await this.room.localParticipant.publishData(payload as Uint8Array<ArrayBuffer>, { topic, reliable });
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token);
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    // On the real student seat (Electron), getDisplayMedia is
    // auto-resolved with no OS picker via
    // session.setDisplayMediaRequestHandler (apps/desktop/src/main/index.ts)
    // — kiosk-appropriate. In a plain browser (teacher/admin dashboard),
    // Chrome's native picker appears, which is exactly what a teacher
    // manually starting a broadcast expects.
    await this.room.localParticipant.setScreenShareEnabled(enabled, { audio: true });
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  private handleTrackSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackSubscribed?.({ participantIdentity: participant.identity, source: track.source, track });
  };

  private handleTrackUnsubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackUnsubscribed?.({ participantIdentity: participant.identity, source: track.source, track });
  };
}
