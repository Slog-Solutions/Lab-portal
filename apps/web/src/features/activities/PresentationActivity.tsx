import { useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { ActivityRecorder } from '../../lib/activity-recorder';

interface PresentationConfig {
  title: string;
  maxDurationSec: number;
}

/**
 * Annexure-I Ser 9: screen capture + audio, teacher or student. Uses the
 * SAME getDisplayMedia() path the broadcast feature does — on the real
 * Electron seat this resolves silently via
 * session.setDisplayMediaRequestHandler (apps/desktop/src/main/index.ts,
 * no OS picker), and in a plain browser it shows the native picker,
 * appropriate for a person deliberately starting a recording of
 * themselves. Manually started/stopped (design doc Ser 9: "record parts
 * of their lesson", not automatic), unlike round table/telephone which
 * record for the activity's whole duration.
 */
export function PresentationActivity({
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
  config: PresentationConfig;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  async function start(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;

      const recorder = new ActivityRecorder(() => control.getToken());
      recorderRef.current = recorder;
      await recorder.start(stream, { kind: RecordingKind.PRESENTATION, sessionId, activityInstanceId: instanceId, stationId });
      setRecording(true);

      // If the user stops sharing via the browser/OS chrome instead of
      // our button, stop the recording too rather than leaving it hanging.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => void stop());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start screen capture');
    }
  }

  async function stop(): Promise<void> {
    await recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-50">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Presentation: {config.title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${recording ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>
          {recording ? '● Recording' : 'Not recording'}
        </span>
      </div>
      <video ref={previewRef} autoPlay muted playsInline className="mb-3 max-h-64 w-full rounded-md bg-black object-contain" />
      {!recording ? (
        <button type="button" onClick={() => void start()} className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600">
          Start Recording
        </button>
      ) : (
        <button type="button" onClick={() => void stop()} className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600">
          Stop &amp; Save
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
