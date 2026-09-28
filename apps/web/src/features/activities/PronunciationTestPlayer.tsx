import { useEffect, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { base64ToAudioUrl, type PronunciationVoice } from '../../lib/pronunciation-api';
import { ActivityRecorder } from '../../lib/activity-recorder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PronunciationTestConfig {
  instructions?: string;
  playModelAudio?: boolean;
  voice?: PronunciationVoice;
}

interface WordRecording {
  recordingId: string;
  playbackUrl: string | null;
}

interface ModelVoice {
  audioUrl: string | null;
  ipa: string | null;
  warning: string | null;
}

/**
 * Ser 7 pronunciation TEST — the teacher gave a list of words and the
 * student records themselves saying each one. Unlike PronunciationPlayer
 * (open practice: one text, self-rated, retry freely) this is an
 * assessment: the words come from the server's item bank, the model voice
 * is only offered when the teacher turned it on for this test, and a
 * submission is final — the server rejects a second one for the same
 * assignment (see AttemptsService.assertTestStartable), so the confirm
 * step below says so plainly. Scoring is the teacher's, later, per word.
 *
 * A word can be re-recorded any number of times before submitting; each
 * take is its own Recording row and only the latest one's id is sent.
 */
export function PronunciationTestPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as PronunciationTestConfig;
  const items = started.items ?? [];
  const total = items.length;

  const [begun, setBegun] = useState(false);
  const [index, setIndex] = useState(0);
  const [recordings, setRecordings] = useState<Record<string, WordRecording>>({});
  const [recordingItemId, setRecordingItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // starting or finishing a take
  const [models, setModels] = useState<Record<string, ModelVoice>>({});
  const [loadingModel, setLoadingModel] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Every object URL this player creates, so unmounting (or leaving mid-test)
  // can't leak them — playback blobs and model-voice audio alike.
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const current = items[index];
  const recordedCount = items.filter((i) => recordings[i.id]).length;
  const allRecorded = total > 0 && recordedCount === total;
  const isRecording = recordingItemId !== null;
  const voice = config.voice ?? 'en_GB';

  function trackUrl(url: string): string {
    urlsRef.current.add(url);
    return url;
  }
  function releaseUrl(url: string | null | undefined): void {
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  }

  async function startRecording(itemId: string): Promise<void> {
    setError(null);
    setConfirming(false);
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new ActivityRecorder(() => control.getToken());
      recorderRef.current = recorder;
      await recorder.start(stream, { kind: RecordingKind.PRONUNCIATION, attemptId: started.attemptId });
      setRecordingItemId(itemId);
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
    const itemId = recordingItemId;
    if (!itemId) return;
    setBusy(true);
    try {
      const id = await recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      streamRef.current = null;
      setRecordingItemId(null);
      if (!id) {
        setError('The recording could not be saved. Please try again.');
        return;
      }
      // Playback is a nicety — the take counts as recorded even if this
      // fetch fails; the server is what verifies the upload on submit.
      let playbackUrl: string | null = null;
      try {
        playbackUrl = trackUrl(await stationApi.fetchBlobUrl(control.getToken(), `/recordings/${id}/file`));
      } catch {
        playbackUrl = null;
      }
      const previous = recordings[itemId]?.playbackUrl;
      releaseUrl(previous);
      setRecordings((prev) => ({ ...prev, [itemId]: { recordingId: id, playbackUrl } }));
    } finally {
      setBusy(false);
    }
  }

  async function hearWord(itemId: string, word: string): Promise<void> {
    setError(null);
    let model = models[itemId];
    if (!model) {
      setLoadingModel(true);
      try {
        const res = await stationApi.speakPronunciation(control.getToken(), word, voice);
        model = {
          audioUrl: res.audioBase64 ? trackUrl(base64ToAudioUrl(res.audioBase64)) : null,
          ipa: res.ipa,
          warning: res.warnings[0] ?? null,
        };
        setModels((prev) => ({ ...prev, [itemId]: model! }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the model voice');
        return;
      } finally {
        setLoadingModel(false);
      }
    }
    if (model.audioUrl) void new Audio(model.audioUrl).play().catch(() => void 0);
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: {},
        itemResponses: items.map((i) => ({ itemId: i.id, given: recordings[i.id]!.recordingId })),
      });
      setDone(true);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{started.exercise.title} — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Your recordings have been sent. Your teacher will listen and score them.</p>
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  if (total === 0 || !current) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{started.exercise.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">This test has no words yet. Please tell your teacher.</p>
          <Button variant="secondary" onClick={onDone}>
            Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!begun) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{started.exercise.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            You will record yourself saying <strong>{total}</strong> {total === 1 ? 'word' : 'words'}, one at a time.
          </p>
          {config.instructions && <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">{config.instructions}</p>}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Say each word clearly, then press Stop.</li>
            <li>You can re-record a word as many times as you like before you submit.</li>
            <li>Once you submit, you cannot change your recordings.</li>
          </ul>
          <div className="flex gap-2">
            <Button onClick={() => setBegun(true)}>Begin test</Button>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentRecording = recordings[current.id];
  const currentModel = models[current.id];
  const recordingThis = recordingItemId === current.id;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{started.exercise.title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Word {index + 1} of {total} · {recordedCount} recorded
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Word navigator — a tick means that word has a saved recording. */}
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              disabled={isRecording || busy}
              onClick={() => setIndex(i)}
              aria-label={`Word ${i + 1}${recordings[item.id] ? ' (recorded)' : ''}`}
              className={`h-8 min-w-8 rounded-md border px-2 text-xs disabled:opacity-50 ${
                i === index ? 'border-primary bg-primary text-primary-foreground' : recordings[item.id] ? 'border-emerald-600 text-emerald-500' : 'border-input'
              }`}
            >
              {recordings[item.id] ? '✓' : i + 1}
            </button>
          ))}
        </div>

        <div className="py-4 text-center">
          <p className="text-4xl font-semibold tracking-wide">{current.prompt}</p>
          {config.playModelAudio && currentModel?.ipa && <p className="mt-2 font-mono text-sm text-muted-foreground">{currentModel.ipa}</p>}
        </div>

        {config.playModelAudio && (
          <div className="flex flex-col items-center gap-1">
            <Button variant="outline" size="sm" disabled={loadingModel || isRecording} onClick={() => void hearWord(current.id, current.prompt)}>
              {loadingModel ? 'Loading…' : 'Hear the word'}
            </Button>
            {currentModel && !currentModel.audioUrl && (
              <p className="text-xs text-muted-foreground">The model voice isn&apos;t available right now — say the word as you know it.</p>
            )}
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          {recordingThis ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording…
              </span>
              <Button variant="secondary" disabled={busy} onClick={() => void stopRecording()}>
                Stop &amp; Save
              </Button>
            </>
          ) : (
            <Button variant="destructive" disabled={busy || isRecording} onClick={() => void startRecording(current.id)}>
              {currentRecording ? 'Re-record' : 'Record'}
            </Button>
          )}
        </div>

        {currentRecording?.playbackUrl && !recordingThis && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Your recording:</p>
            <audio controls src={currentRecording.playbackUrl} className="w-full" />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" size="sm" disabled={index === 0 || isRecording || busy} onClick={() => setIndex(index - 1)}>
            ← Previous
          </Button>
          <Button variant="ghost" size="sm" disabled={index === total - 1 || isRecording || busy} onClick={() => setIndex(index + 1)}>
            Next →
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2 border-t border-border pt-3">
          {confirming ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm">You can&apos;t change your recordings after submitting. Submit now?</p>
              <div className="flex gap-2">
                <Button onClick={() => void submit()} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Yes, submit'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
                  Keep editing
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={() => setConfirming(true)} disabled={!allRecorded || isRecording || busy}>
                Submit test
              </Button>
              {!allRecorded && (
                <p className="text-xs text-muted-foreground">
                  Record all {total} words to submit ({total - recordedCount} left).
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
