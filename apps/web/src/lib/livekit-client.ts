import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';

export interface RemoteTrackHandle {
  participantIdentity: string;
  /** LiveKit participant display name (MediaService.mintToken's
   * `displayName` — "System <n>" for a station, "Teacher (<serviceNumber>)"
   * for a dashboard connection). Used to label a spotlighted screen-share
   * pane without the caller needing to separately look up the station. */
  participantName: string;
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
  /** Browser autoplay blocked remote audio/video until a user gesture —
   * fires false right after a fresh page load with tracks already
   * subscribed, true again once startAudio() (called from a click
   * handler) unblocks it. */
  onAudioPlaybackChanged?: (canPlay: boolean) => void;
  /** The local screen-share track was unpublished from outside our own
   * setScreenShareEnabled(false) call — e.g. the teacher clicked
   * Chrome's own "Stop sharing" bar instead of our button. */
  onLocalScreenShareEnded?: () => void;
  /** This participant's OWN publish right changed on the server — Round
   * Table (Ser 3) grants/revokes the mic in place as the floor moves. Not an
   * error: the caller just reflects it ("Waiting for the floor"). */
  onLocalPermissionsChanged?: (canPublishMic: boolean) => void;
  /** Identities of whoever LiveKit currently hears speaking (includes us). */
  onActiveSpeakersChanged?: (identities: string[]) => void;
  /** Fires on the first connect and again after LiveKit's own full reconnect. */
  onConnected?: () => void;
  onReconnected?: () => void;
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
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, () => this.events.onAudioPlaybackChanged?.(this.room.canPlaybackAudio));
    this.room.on(RoomEvent.Connected, () => this.events.onConnected?.());
    this.room.on(RoomEvent.Reconnected, () => this.events.onReconnected?.());
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.events.onActiveSpeakersChanged?.(speakers.map((p) => p.identity)));
    this.room.on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
      if (participant === this.room.localParticipant) this.events.onLocalPermissionsChanged?.(this.canPublishMic);
    });
    this.room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) this.events.onLocalScreenShareEnded?.();
    });
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

  /** Whether the server currently lets THIS participant publish a mic. */
  get canPublishMic(): boolean {
    return this.room.localParticipant.permissions?.canPublish ?? false;
  }

  get localIdentity(): string {
    return this.room.localParticipant.identity;
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token);
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  /** captureAudio defaults to false — a spotlighted/remote-controlled
   * student's screen capture must NOT also grab system audio (Electron's
   * `'loopback'` handler would pick up everything the seat is currently
   * playing, including the teacher's own voice and other students'
   * unmuted mics coming through this same console, and echo it back to
   * the whole class). Only the teacher's own broadcast passes true. */
  async setScreenShareEnabled(enabled: boolean, captureAudio = false): Promise<void> {
    // On the real student seat (Electron), getDisplayMedia is
    // auto-resolved with no OS picker via
    // session.setDisplayMediaRequestHandler (apps/desktop/src/main/index.ts)
    // — kiosk-appropriate. In a plain browser (teacher/admin dashboard),
    // Chrome's native picker appears, which is exactly what a teacher
    // manually starting a broadcast expects.
    await this.room.localParticipant.setScreenShareEnabled(enabled, { audio: captureAudio });
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  /** Resumes remote audio/video playback after the browser's autoplay
   * policy blocked it (see onAudioPlaybackChanged) — must be called from
   * inside a user-gesture event handler. */
  async startAudio(): Promise<void> {
    await this.room.startAudio();
  }

  private handleTrackSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackSubscribed?.({ participantIdentity: participant.identity, participantName: participant.name ?? participant.identity, source: track.source, track });
  };

  private handleTrackUnsubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackUnsubscribed?.({ participantIdentity: participant.identity, participantName: participant.name ?? participant.identity, source: track.source, track });
  };
}
