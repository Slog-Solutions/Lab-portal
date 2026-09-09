import type { RecordingKind } from '@lab/shared';
import { getRuntimeConfig } from './runtime-config';

/**
 * Client-side recording (design doc §2.6): create the Recording row
 * BEFORE capture starts, record locally via MediaRecorder, upload the
 * blob on stop. This is the one mechanism every Phase 2 activity's
 * recording requirement reuses — model imitation, round table, telephone,
 * presentation, and now pronunciation all differ only in which
 * MediaStream they hand it.
 *
 * Auth (Phase 3): RecordingsController is station-authenticated now (it
 * used to be @Public() — a documented Phase 1/2 gap), so this class needs
 * the CALLER's own station token, not the human dashboard's — there is no
 * human login on a student seat. `getToken` is a function, not a
 * snapshot, because the token can be re-minted (station:hello on
 * reconnect) after this recorder is constructed.
 */
export class ActivityRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingId: string | null = null;
  private startedAt = 0;

  constructor(private readonly getToken: () => string | null) {}

  async start(stream: MediaStream, params: {
    kind: RecordingKind;
    sessionId?: string;
    activityInstanceId?: string;
    attemptId?: string;
    stationId?: string;
    studentIds?: string[];
  }): Promise<string> {
    const { serverUrl } = getRuntimeConfig();
    const token = this.getToken();
    const res = await fetch(`${serverUrl}/api/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Failed to create recording (${res.status})`);
    const recording = (await res.json()) as { id: string };
    this.recordingId = recording.id;
    this.chunks = [];
    this.startedAt = Date.now();

    // audio/webm;codecs=opus for mic-only captures, video/webm;codecs=vp8,opus
    // for screen — MediaRecorder picks a sane default per track kind if
    // we don't force a mimeType, which is what we want here since the
    // same class serves both audio-only and audio+video callers.
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // 1s timeslice so a crash doesn't lose everything
    return recording.id;
  }

  /** Resolves to the recording id once the upload completes (or null if
   * start() was never called — activity components don't all guarantee a
   * matched start/stop in every code path, e.g. unmounting mid-error). */
  async stop(): Promise<string | null> {
    if (!this.recorder || !this.recordingId) return null;
    const recordingId = this.recordingId;
    const durationMs = Date.now() - this.startedAt;

    const blob = await new Promise<Blob>((resolve) => {
      this.recorder!.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder!.mimeType }));
      this.recorder!.stop();
    });

    const { serverUrl } = getRuntimeConfig();
    const token = this.getToken();
    const form = new FormData();
    const ext = blob.type.includes('webm') ? 'webm' : 'bin';
    form.append('file', blob, `${recordingId}.${ext}`);
    const res = await fetch(`${serverUrl}/api/recordings/${recordingId}/upload?durationMs=${durationMs}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[activity-recorder] upload failed (${res.status}) for recording ${recordingId}`);
    }

    this.recorder = null;
    this.recordingId = null;
    this.chunks = [];
    return recordingId;
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }
}
