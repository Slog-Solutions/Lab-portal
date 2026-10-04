import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';

/** What the subscription filter is told about a publication, before any
 * track exists to inspect. Deliberately only the fields LiveKit gives us
 * pre-subscribe. */
export interface TrackPublicationInfo {
  participantIdentity: string;
  /** Publisher-set track name — `tr:<lang>` for a translation channel
   * (see translationTrackName in packages/shared). */
  trackName: string;
  source: Track.Source;
  kind: 'audio' | 'video' | 'unknown';
}

export interface RemoteTrackHandle {
  participantIdentity: string;
  /** The publication's track name, needed to tell one translation
   * language's audio from another's — both are Microphone-source audio
   * from the same participant, so `source` alone cannot. */
  trackName: string;
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
  /**
   * Decides, per publication, whether this client subscribes at all.
   * Returning false means the track is never sent over the network, not
   * merely muted locally — which is the point: a class with four
   * translation languages publishes four audio tracks, and a student who
   * downloaded all of them would waste bandwidth and (worse) have every
   * language's audio one `attach()` away from playing at once.
   *
   * Supplying this switches the room to autoSubscribe:false, so the
   * filter is authoritative for EVERY track in the room — a filter that
   * forgets to allow screen share will silently hide the teacher's
   * screen. Omit it to keep LiveKit's default subscribe-to-everything.
   */
  subscriptionFilter?: (info: TrackPublicationInfo) => boolean;
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
    if (events.subscriptionFilter) {
      // Applied on publish AND on connect (for publications that already
      // existed), since TrackPublished only fires for tracks published
      // after we joined — a student joining a class mid-lecture would
      // otherwise subscribe to nothing at all.
      this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
        this.applyFilter(publication, participant.identity);
      });
      this.room.on(RoomEvent.Connected, () => this.refreshSubscriptions());
    }
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
    // autoSubscribe is inverted by the presence of a filter: with one, the
    // server sends nothing until we opt in per publication.
    await this.room.connect(url, token, { autoSubscribe: !this.events.subscriptionFilter });
  }

  /**
   * Re-evaluates the subscription filter against every publication
   * currently in the room. Call this whenever the filter's own inputs
   * change — the student console calls it when the listener picks a new
   * translation language, which is what swaps which `tr:<lang>` track is
   * actually streaming without reconnecting to the room.
   */
  refreshSubscriptions(): void {
    if (!this.events.subscriptionFilter) return;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.applyFilter(publication, participant.identity);
      }
    }
  }

  private applyFilter(publication: RemoteTrackPublication, participantIdentity: string): void {
    const filter = this.events.subscriptionFilter;
    if (!filter) return;
    const wanted = filter({
      participantIdentity,
      trackName: publication.trackName,
      source: publication.source,
      kind: publication.kind === Track.Kind.Audio ? 'audio' : publication.kind === Track.Kind.Video ? 'video' : 'unknown',
    });
    // setSubscribed is idempotent in livekit-client, so re-applying the
    // same decision on every refresh costs nothing.
    publication.setSubscribed(wanted);
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

  private handleTrackSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackSubscribed?.({
      participantIdentity: participant.identity,
      participantName: participant.name ?? participant.identity,
      trackName: publication.trackName,
      source: track.source,
      track,
    });
  };

  private handleTrackUnsubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void => {
    this.events.onTrackUnsubscribed?.({
      participantIdentity: participant.identity,
      participantName: participant.name ?? participant.identity,
      trackName: publication.trackName,
      source: track.source,
      track,
    });
  };
}
