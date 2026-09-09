import { useEffect, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { ActivityRecorder } from '../../lib/activity-recorder';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PronunciationConfig {
  sourceText: string;
  ipaAssetId?: string;
  modelAudioAssetId?: string;
  voice: 'en_US' | 'en_GB';
}

/** Fetches an authenticated asset/recording as a blob URL — needed
 * because <audio src> / <img src> can't carry an Authorization header,
 * unlike a plain fetch(). Caller owns revoking the returned URL. */
async function fetchAsObjectUrl(url: string, token: string | null): Promise<string> {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Ser 7 "Pronunciation Activity" — any text becomes a record/compare
 * exercise. Model audio + IPA come from the offline eSpeak-NG/Piper
 * pipeline (pronunciation/pronunciation.service.ts) via the exercise's
 * config asset ids; recording reuses the same ActivityRecorder every
 * Phase 2 activity uses. Scoring is a self-rating at submit time — a
 * teacher's assessment overlays it later via the gradebook's audited
 * ScoreOverride (see attempts.service.ts's doc comment on why this isn't
 * auto-scored).
 */
export function PronunciationPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as PronunciationConfig;
  const [ipaText, setIpaText] = useState<string | null>(null);
  const [modelAudioUrl, setModelAudioUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [selfScore, setSelfScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    const token = control.getToken();

    if (config.ipaAssetId) {
      fetch(`${serverUrl}/api/media-assets/${config.ipaAssetId}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((res) => res.text())
        .then(setIpaText)
        .catch(() => setIpaText(null));
    }
    if (config.modelAudioAssetId) {
      void fetchAsObjectUrl(`${serverUrl}/api/media-assets/${config.modelAudioAssetId}/file`, token)
        .then(setModelAudioUrl)
        .catch(() => setModelAudioUrl(null));
    }
    return () => {
      if (modelAudioUrl) URL.revokeObjectURL(modelAudioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ipaAssetId, config.modelAudioAssetId]);

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new ActivityRecorder(() => control.getToken());
      recorderRef.current = recorder;
      await recorder.start(stream, { kind: RecordingKind.PRONUNCIATION, attemptId: started.attemptId });
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access failed');
    }
  }

  async function stopRecording(): Promise<void> {
    const id = await recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setRecording(false);
    if (id) {
      setRecordedId(id);
      const { serverUrl } = getRuntimeConfig();
      try {
        const url = await fetchAsObjectUrl(`${serverUrl}/api/recordings/${id}/file`, control.getToken());
        setPlaybackUrl(url);
      } catch {
        // playback is a nicety; submission below doesn't depend on it
      }
    }
  }

  async function submit(): Promise<void> {
    if (!recordedId) return;
    setSubmitting(true);
    setError(null);
    try {
      await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: { studentAudioAssetId: recordedId, selfAssessedScore: selfScore ?? undefined },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pronunciation — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Awaiting teacher review.</p>
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{started.exercise.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-lg">{config.sourceText}</p>
        {ipaText && <p className="font-mono text-sm text-muted-foreground">{ipaText}</p>}
        {modelAudioUrl && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Model pronunciation ({config.voice}):</p>
            <audio controls src={modelAudioUrl} className="w-full" />
          </div>
        )}

        <div className="flex items-center gap-2">
          {!recording ? (
            <Button variant="destructive" onClick={() => void startRecording()}>
              Record my attempt
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void stopRecording()}>
              Stop &amp; Save
            </Button>
          )}
        </div>

        {playbackUrl && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Your attempt:</p>
            <audio controls src={playbackUrl} className="w-full" />
          </div>
        )}

        {recordedId && (
          <div>
            <p className="mb-1 text-sm font-medium">Rate your own attempt (1-5):</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSelfScore(n)}
                  className={`h-8 w-8 rounded-md border text-sm ${
                    selfScore === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {recordedId && (
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
