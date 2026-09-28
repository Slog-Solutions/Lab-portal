import { Room, RoomEvent, Track } from 'livekit-client';
import { ChunkUploadError, classRecordingsApi } from '../../lib/class-recordings-api';

export type ClassRecorderStatus = 'idle' | 'recording' | 'saving' | 'saved' | 'error';

export interface ClassRecorderState {
  status: ClassRecorderStatus;
  startedAt: number | null;
  /** Chunks uploaded to but not yet acknowledged by the server — shown as
   * "uploading…" so the teacher doesn't click Stop and assume it's instant. */
  pendingChunks: number;
  withAudio: boolean;
  error: string | null;
}

function pickMimeType(withAudio: boolean): string {
  const candidates = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return 'video/webm';
}

/**
 * Records the teacher's own class broadcast (BroadcastPanel's Record
 * button), client-side — LiveKit Egress needs Docker/Linux, unavailable
 * on the Windows lab server (infra/README.md), so this mirrors
 * ActivityRecorder's "capture in the browser, stream the bytes up"
 * design, but for a 1-2h class: chunked upload instead of one blob (see
 * class-recordings-api.ts), and a WebAudio mix of the teacher's already-
 * published LiveKit tracks instead of a fresh capture — "with audio" is
 * then exactly what students hear (mic muted -> silence in the mix, not
 * a paused capture; a late-published mic/screen-audio track is picked up
 * automatically via RoomEvent.LocalTrackPublished).
 *
 * A plain class, not React state, so an upload already in flight survives
 * the owning panel unmounting. `stop()` is idempotent and safe to call
 * from every place a broadcast can end.
 */
export class ClassRecorder {
  private recorder: MediaRecorder | null = null;
  private recordingId: string | null = null;
  private audioContext: AudioContext | null = null;
  private mixDestination: MediaStreamAudioDestinationNode | null = null;
  private connectedSources = new Set<MediaStreamTrack>();
  private uploadQueue: Promise<void> = Promise.resolve();
  private nextSeq = 0;
  private pendingChunks = 0;
  private startedAt: number | null = null;
  private room: Room | null = null;
  private unsubscribe: (() => void) | null = null;
  private status: ClassRecorderStatus = 'idle';
  private withAudioFlag = false;
  private lastError: string | null = null;
  /** Set for the duration of one stop() call — BroadcastPanel calls stop()
   * from several places that can fire close together (Stop recording,
   * Stop broadcast, screen-share ended, disconnect, unmount); without
   * this, a second concurrent call would see `this.recorder` still set
   * (cleared only once the first call's stop sequence finishes — see
   * stop()'s own comment) and set its own competing `onstop` handler on
   * the same MediaRecorder. */
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly onState: (state: ClassRecorderState) => void) {}

  get isRecording(): boolean {
    return this.status === 'recording';
  }

  async start(room: Room, withAudio: boolean): Promise<void> {
    if (this.recorder) return;
    const screenTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
    if (!screenTrack) throw new Error('Start the broadcast first');

    const { id } = await classRecordingsApi.start(withAudio);

    this.room = room;
    this.recordingId = id;
    this.nextSeq = 0;
    this.pendingChunks = 0;
    this.lastError = null;
    this.withAudioFlag = withAudio;
    this.uploadQueue = Promise.resolve();

    const tracks: MediaStreamTrack[] = [screenTrack];
    if (withAudio) {
      this.audioContext = new AudioContext();
      this.mixDestination = this.audioContext.createMediaStreamDestination();
      this.connectSource(Track.Source.Microphone);
      this.connectSource(Track.Source.ScreenShareAudio);
      const onPublished = () => {
        this.connectSource(Track.Source.Microphone);
        this.connectSource(Track.Source.ScreenShareAudio);
      };
      room.on(RoomEvent.LocalTrackPublished, onPublished);
      this.unsubscribe = () => room.off(RoomEvent.LocalTrackPublished, onPublished);
      tracks.push(...this.mixDestination.stream.getAudioTracks());
    }

    this.recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: pickMimeType(withAudio),
      videoBitsPerSecond: 1_500_000,
      ...(withAudio ? { audioBitsPerSecond: 96_000 } : {}),
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.enqueueUpload(e.data);
    };
    this.startedAt = Date.now();
    this.status = 'recording';
    this.recorder.start(5000); // 5s chunks — see class-recordings-api.ts's doc comment on why this streams at all
    this.publish();
  }

  /** Wires one more local track into the mix, if it exists and isn't
   * already connected — called at start, and again on every later
   * LocalTrackPublished (the teacher can turn the mic on after Record). */
  private connectSource(source: Track.Source): void {
    if (!this.audioContext || !this.mixDestination || !this.room) return;
    const mediaTrack = this.room.localParticipant.getTrackPublication(source)?.track?.mediaStreamTrack;
    if (!mediaTrack || this.connectedSources.has(mediaTrack)) return;
    try {
      this.audioContext.createMediaStreamSource(new MediaStream([mediaTrack])).connect(this.mixDestination);
      this.connectedSources.add(mediaTrack);
    } catch {
      // A track that never carries real audio throws on some browsers —
      // recording continues with whatever else is mixed in.
    }
  }

  private enqueueUpload(blob: Blob): void {
    const id = this.recordingId;
    if (!id) return;
    const seq = this.nextSeq++;
    this.pendingChunks += 1;
    this.publish();
    this.uploadQueue = this.uploadQueue.then(() =>
      this.uploadWithRetry(id, seq, blob).finally(() => {
        this.pendingChunks -= 1;
        this.publish();
      }),
    );
  }

  private async uploadWithRetry(id: string, seq: number, blob: Blob, attempt = 0): Promise<void> {
    try {
      await classRecordingsApi.uploadChunk(id, seq, blob);
    } catch (err) {
      // A 409 means the server and this recorder disagree about where the
      // stream is — nothing this retry loop does will fix that, so surface
      // it instead of spinning forever (a real network/5xx blip is the
      // only case worth retrying).
      if (err instanceof ChunkUploadError && err.status === 409) {
        this.status = 'error';
        this.lastError = 'Recording upload lost sync — stop and start a new recording';
        this.publish();
        return;
      }
      if (attempt >= 6) {
        this.status = 'error';
        this.lastError = 'Recording upload failed — check your connection';
        this.publish();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1000 * 2 ** attempt)));
      return this.uploadWithRetry(id, seq, blob, attempt + 1);
    }
  }

  /** Idempotent: a no-op once already stopped, and safe to call again
   * while a previous call is still finishing (see stopPromise's doc
   * comment) — so BroadcastPanel can call this unconditionally from Stop
   * recording, Stop broadcast, screen-share ending, disconnect, and
   * unmount without tracking which one fired or which already ran. */
  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const recorder = this.recorder;
    const recordingId = this.recordingId;
    if (!recorder || !recordingId) return;

    this.stopPromise = this.runStop(recorder, recordingId);
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async runStop(recorder: MediaRecorder, recordingId: string): Promise<void> {
    this.status = 'saving';
    this.publish();

    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve();
        return;
      }
      // MediaRecorder.stop() fires one final 'dataavailable' (whatever was
      // buffered since the last 5s timeslice) BEFORE 'stop' — enqueueUpload
      // reads this.recordingId, so it must still be set when that final
      // event lands, or its chunk (for a recording under 5s, its ONLY
      // chunk) is silently dropped. Don't null recorder/recordingId until
      // after this promise resolves.
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    this.recorder = null;
    this.recordingId = null;
    await this.uploadQueue;

    this.unsubscribe?.();
    this.unsubscribe = null;
    this.connectedSources.clear();
    if (this.audioContext) await this.audioContext.close().catch(() => undefined);
    this.audioContext = null;
    this.mixDestination = null;
    this.room = null;

    try {
      const result = await classRecordingsApi.finish(recordingId, durationMs);
      if (result.status === 'failed') {
        // Every chunk upload failed (or none was ever produced) — the
        // server itself refuses to call this 'ready' (see
        // ClassRecordingsService.finish), so don't tell the teacher it
        // saved when there is nothing to play back.
        this.status = 'error';
        this.lastError = 'Nothing was captured — check your connection and try recording again';
      } else {
        this.status = 'saved';
      }
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'Failed to save recording';
    }
    this.publish();
  }

  private publish(): void {
    this.onState({
      status: this.status,
      startedAt: this.startedAt,
      pendingChunks: this.pendingChunks,
      withAudio: this.withAudioFlag,
      error: this.lastError,
    });
  }
}
