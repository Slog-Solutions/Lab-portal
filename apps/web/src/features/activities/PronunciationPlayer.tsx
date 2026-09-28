import { useEffect, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { base64ToAudioUrl } from '../../lib/pronunciation-api';
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
 *
 * A take can be discarded and re-recorded any number of times before
 * submitting ("Improvise") — each take is its own Recording row on this
 * attempt (see ActivityRecorder.start), and only the latest one's id is
 * submitted; the server double-checks it actually finished uploading
 * (AttemptsService.submitPronunciation).
 *
 * "Listen to pronunciation" plays the teacher's pre-generated model audio
 * when the exercise has one (config.modelAudioAssetId, set at authoring
 * time); otherwise it synthesizes on demand via /pronunciation/speak —
 * the same offline eSpeak-NG/Piper pipeline, just run against the whole
 * sourceText instead of one word — so a student can always hear the line
 * before recording even if the teacher skipped "Generate IPA + Model
 * Audio" (or the pipeline wasn't configured yet) when they saved it.
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
  const [liveModelUrl, setLiveModelUrl] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [listenWarning, setListenWarning] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [takeCount, setTakeCount] = useState(0);
  const [selfScore, setSelfScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); // starting or finishing a take
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Every object URL this player creates (model audio + each take's
  // playback), so unmounting mid-practice can't leak them.
  const urlsRef = useRef<Set<string>>(new Set());

  function trackUrl(url: string): string {
    urlsRef.current.add(url);
    return url;
  }
  function releaseUrl(url: string | null | undefined): void {
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  }

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

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
        .then((url) => setModelAudioUrl(trackUrl(url)))
        .catch(() => setModelAudioUrl(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ipaAssetId, config.modelAudioAssetId]);

  /** Plays the pre-generated model audio if there is one; otherwise
   * synthesizes it on demand (once — the result is cached here and on the
   * server) and plays that. Either way this is what "Listen to
   * pronunciation" does, always before a student records. */
  async function listenToPronunciation(): Promise<void> {
    setError(null);
    const cached = modelAudioUrl ?? liveModelUrl;
    if (cached) {
      void new Audio(cached).play().catch(() => void 0);
      return;
    }
    setListening(true);
    try {
      const res = await stationApi.speakPronunciation(control.getToken(), config.sourceText, config.voice);
      if (res.ipa && !ipaText) setIpaText(res.ipa);
      if (res.audioBase64) {
        const url = trackUrl(base64ToAudioUrl(res.audioBase64));
        setLiveModelUrl(url);
        void new Audio(url).play().catch(() => void 0);
      } else {
        setListenWarning(res.warnings[0] ?? "The model voice isn't available on this system.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the pronunciation');
    } finally {
      setListening(false);
    }
  }

  async function startRecording(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new ActivityRecorder(() => control.getToken());
      recorderRef.current = recorder;
      await recorder.start(stream, { kind: RecordingKind.PRONUNCIATION, attemptId: started.attemptId });
      setRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setError(err instanceof Error ? err.message : 'Microphone access failed');
    } finally {
      setBusy(false);
    }
  }

  async function stopRecording(): Promise<void> {
    setBusy(true);
    try {
      const id = await recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      streamRef.current = null;
      setRecording(false);
      if (!id) {
        setError('The recording could not be saved. Please try again.');
        return;
      }
      setRecordedId(id);
      setTakeCount((n) => n + 1);
      releaseUrl(playbackUrl);
      setPlaybackUrl(null);
      const { serverUrl } = getRuntimeConfig();
      try {
        const url = await fetchAsObjectUrl(`${serverUrl}/api/recordings/${id}/file`, control.getToken());
        setPlaybackUrl(trackUrl(url));
      } catch {
        // playback is a nicety; submission below doesn't depend on it
      }
    } finally {
      setBusy(false);
    }
  }

  /** Discards the current take and records a fresh one against the same
   * attempt — as many times as the student likes before submitting. */
  async function improvise(): Promise<void> {
    setError(null);
    releaseUrl(playbackUrl);
    setPlaybackUrl(null);
    setRecordedId(null);
    setSelfScore(null);
    await startRecording();
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

        <div className="space-y-2">
          <Button variant="outline" disabled={listening || recording} onClick={() => void listenToPronunciation()}>
            {listening ? 'Loading…' : 'Listen to pronunciation'}
          </Button>
          {(modelAudioUrl ?? liveModelUrl) ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Model pronunciation ({config.voice}):</p>
              <audio controls src={modelAudioUrl ?? liveModelUrl ?? undefined} className="w-full" />
            </div>
          ) : (
            listenWarning && <p className="text-xs text-muted-foreground">{listenWarning} You can still record yourself.</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!recording ? (
            <Button variant="destructive" disabled={busy} onClick={() => void (recordedId ? improvise() : startRecording())}>
              {recordedId ? 'Improvise — record again' : 'Record my attempt'}
            </Button>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-sm text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording…
              </span>
              <Button variant="secondary" disabled={busy} onClick={() => void stopRecording()}>
                Stop &amp; Save
              </Button>
            </>
          )}
        </div>

        {playbackUrl && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Your attempt{takeCount > 1 ? ` (take ${takeCount})` : ''}:</p>
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
          <Button onClick={() => void submit()} disabled={submitting || busy || recording}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
