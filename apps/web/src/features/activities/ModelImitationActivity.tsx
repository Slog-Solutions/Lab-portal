import { useEffect, useMemo, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { ActivityRecorder } from '../../lib/activity-recorder';
import { getRuntimeConfig } from '../../lib/runtime-config';

interface ModelImitationConfig {
  masterTrackAssetId: string;
  pausePoints: number[];
  allowManualPause: boolean;
}

/** Fetches an authenticated media asset as a blob URL â€” <audio src> can't
 * carry an Authorization header (same constraint PronunciationPlayer's
 * fetchAsObjectUrl documents), unlike a plain fetch(). */
async function fetchAsObjectUrl(url: string, token: string | null): Promise<string> {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Failed to fetch master track (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Annexure-I Ser 2: listen-and-repeat with a recorded student track.
 * Phase 3 closed this activity's only missing dependency (the Media
 * Library â€” MediaAssetsController's authenticated streaming), so this
 * pass wires the actual playback: `config.masterTrackAssetId` streams
 * from `/api/media-assets/:id/file` the same way PronunciationPlayer's
 * model audio already does. Pause points log the master track's real
 * `currentTime` now instead of the placeholder `masterOffsetMs: 0` this
 * component shipped with before playback existed â€” matching the
 * response schema's actual intent (packages/shared/src/activities:
 * "{masterOffsetMs, wallClockMs} pairs").
 */
export function ModelImitationActivity({
  control,
  sessionId,
  instanceId,
  stationId,
  config,
}: {
  control: StationControlClient;
  sessionId: string;
  instanceId: string;
  stationId: string;
  config: ModelImitationConfig;
}) {
  const [masterTrackUrl, setMasterTrackUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [waiting, setWaiting] = useState(false); // model track is paused, student's turn
  const [pauseLog, setPauseLog] = useState<Array<{ masterOffsetMs: number; wallClockMs: number }>>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const nextPauseRef = useRef(0);
  const pausePoints = useMemo(() => [...config.pausePoints].sort((a, b) => a - b), [config.pausePoints]);

  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    let cancelled = false;
    fetchAsObjectUrl(`${serverUrl}/api/media-assets/${config.masterTrackAssetId}/file`, control.getToken())
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        setMasterTrackUrl(url);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load master track'));
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.masterTrackAssetId]);

  async function startRecording(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const recorder = new ActivityRecorder(() => control.getToken());
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setPauseLog([]);
    await recorder.start(stream, { kind: RecordingKind.MODEL_IMITATION, sessionId, activityInstanceId: instanceId, stationId });
    setRecording(true);
  }

  function recordPause(): void {
    if (!recording) return;
    const masterOffsetMs = Math.round((audioRef.current?.currentTime ?? 0) * 1000);
    setPauseLog((prev) => [...prev, { masterOffsetMs, wallClockMs: Date.now() - startedAtRef.current }]);
  }

  /** Readymade pauses: stop the model track when playback reaches the next
   * authored pause point, so the student can repeat before resuming. */
  function onTimeUpdate(): void {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const at = nextPauseRef.current;
    const point = pausePoints[at];
    if (point !== undefined && audio.currentTime * 1000 >= point) {
      nextPauseRef.current = at + 1;
      audio.pause();
      setWaiting(true);
      recordPause();
    }
  }

  /** After a seek, continue from the first pause point still ahead. */
  function onSeeked(): void {
    const ms = (audioRef.current?.currentTime ?? 0) * 1000;
    const idx = pausePoints.findIndex((p) => p > ms);
    nextPauseRef.current = idx === -1 ? pausePoints.length : idx;
  }

  /** Manual pause: really pauses (or resumes) the model track. */
  function toggleManualPause(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
      recordPause();
    }
  }

  async function stopRecording(): Promise<void> {
    await recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setRecording(false);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-50">
      <h2 className="mb-3 text-sm font-semibold">Model Imitation</h2>

      {loadError && (
        <p className="mb-3 rounded-md bg-red-950 px-2 py-1 text-xs text-red-300">Master track unavailable: {loadError}</p>
      )}
      {masterTrackUrl && (
        <div className="mb-3">
          <p className="mb-1 text-xs text-slate-500">Master track:</p>
          <audio
            ref={audioRef}
            controls
            src={masterTrackUrl}
            className="w-full"
            onTimeUpdate={onTimeUpdate}
            onSeeked={onSeeked}
            onPlay={() => setWaiting(false)}
            onEnded={() => {
              nextPauseRef.current = 0;
              setWaiting(false);
            }}
          />
          {waiting && (
            <p className="mt-1 text-xs font-medium text-amber-400">
              Your turn — repeat what you heard, then press play to continue.
            </p>
          )}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
          >
            Start Recording
          </button>
        ) : (
          <>
            {config.allowManualPause && (
              <button type="button" onClick={toggleManualPause} className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600">
                Pause / Resume model
              </button>
            )}
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600"
            >
              Stop &amp; Save
            </button>
          </>
        )}
      </div>

      {pauseLog.length > 0 && (
        <p className="text-xs text-slate-500">
          {pauseLog.length} pause(s) marked â€” last at {(pauseLog[pauseLog.length - 1]!.masterOffsetMs / 1000).toFixed(1)}s into the master track.
        </p>
      )}
    </div>
  );
}
