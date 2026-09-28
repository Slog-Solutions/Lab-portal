import { useEffect, useRef, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { base64ToAudioUrl, type PronunciationVoice } from '../../lib/pronunciation-api';
import { useTakeRecorder } from './use-take-recorder';
import { SubmitBar } from './SubmitBar';
import { AssetViewer } from '../media/AssetViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ReadingTestConfig {
  instructions?: string;
  voice?: PronunciationVoice;
}

/**
 * Reading Test (Create Assignment -> Reading Test): the teacher's passage is
 * served as this attempt's one item (AttemptsService.prepareServe); the
 * student reads it aloud, may re-record any number of takes, then submits
 * once (READING_TEST is one-shot — see ONE_SHOT_TYPES). A teacher marks it
 * later (AssessmentsService.grade), so there is no self-rating here, unlike
 * the open-practice PRONUNCIATION activity this player's recording plumbing
 * is adapted from (see useTakeRecorder's doc comment).
 *
 * "Listen to pronunciation" always synthesizes on demand via
 * /pronunciation/speak — a reading test never pre-generates model audio at
 * authoring time — and degrades gracefully when the offline eSpeak-NG/Piper
 * pipeline isn't installed (the endpoint returns a warning, not an error).
 */
export function ReadingTestPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as ReadingTestConfig;
  const item = started.items?.[0];
  const voice = config.voice ?? 'en_GB';
  const { take, isRecording, busy, error: recordError, start, stop, retake, trackUrl } = useTakeRecorder(control, started.attemptId);

  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [listenWarning, setListenWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The teacher's uploaded PDF, if any — fetched (and cached) on demand,
  // same "blob URL because <iframe src> can't carry Authorization" pattern
  // StudyMaterialItem uses for a study module's files.
  const [documentOpen, setDocumentOpen] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const documentUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (documentUrlRef.current) URL.revokeObjectURL(documentUrlRef.current);
    },
    [],
  );

  async function toggleDocument(): Promise<void> {
    if (documentOpen) {
      setDocumentOpen(false);
      return;
    }
    if (!item?.mediaAssetId) return;
    setDocumentError(null);
    if (documentUrlRef.current) {
      setDocumentOpen(true);
      return;
    }
    setDocumentBusy(true);
    try {
      const url = await stationApi.fetchBlobUrl(control.getToken(), `/media-assets/${item.mediaAssetId}/file`);
      documentUrlRef.current = url;
      setDocumentUrl(url);
      setDocumentOpen(true);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : 'Could not load the document');
    } finally {
      setDocumentBusy(false);
    }
  }

  async function listenToPronunciation(): Promise<void> {
    if (!item?.prompt) return;
    setSubmitError(null);
    if (modelUrl) {
      void new Audio(modelUrl).play().catch(() => void 0);
      return;
    }
    setListening(true);
    try {
      const res = await stationApi.speakPronunciation(control.getToken(), item.prompt, voice);
      if (res.audioBase64) {
        const url = trackUrl(base64ToAudioUrl(res.audioBase64));
        setModelUrl(url);
        void new Audio(url).play().catch(() => void 0);
      } else {
        setListenWarning(res.warnings[0] ?? "The model voice isn't available on this system.");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not load the pronunciation');
    } finally {
      setListening(false);
    }
  }

  async function submit(): Promise<void> {
    if (!take) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: { studentAudioAssetId: take.recordingId },
      });
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (!item) {
    return <p className="text-sm text-muted-foreground">This test has no passage.</p>;
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reading Test — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Your teacher will listen and give you a mark.</p>
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
        {config.instructions && <p className="text-sm text-muted-foreground">{config.instructions}</p>}
        {item.prompt && <p className="rounded-md bg-muted/50 p-3 text-lg leading-relaxed">{item.prompt}</p>}

        {item.mediaAssetId && (
          <div className="space-y-2">
            <Button variant="outline" disabled={documentBusy} onClick={() => void toggleDocument()}>
              {documentBusy ? 'Loading…' : documentOpen ? 'Hide document' : 'Open document'}
            </Button>
            {documentError && <p className="text-sm text-destructive">{documentError}</p>}
            {documentOpen && documentUrl && <AssetViewer kind="pdf" url={documentUrl} title={started.exercise.title} height="28rem" />}
          </div>
        )}

        {item.prompt && (
          <div className="space-y-2">
            <Button variant="outline" disabled={listening || isRecording} onClick={() => void listenToPronunciation()}>
              {listening ? 'Loading…' : 'Listen to pronunciation'}
            </Button>
            {modelUrl ? (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Model pronunciation ({voice}):</p>
                <audio controls src={modelUrl} className="w-full" />
              </div>
            ) : (
              listenWarning && <p className="text-xs text-muted-foreground">{listenWarning} You can still record yourself.</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          {!isRecording ? (
            <Button variant="destructive" disabled={busy} onClick={() => void (take ? retake() : start())}>
              {take ? 'Record again' : 'Record my reading'}
            </Button>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-sm text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording…
              </span>
              <Button variant="secondary" disabled={busy} onClick={() => void stop()}>
                Stop &amp; Save
              </Button>
            </>
          )}
        </div>

        {take?.playbackUrl && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Your reading{take.index > 1 ? ` (take ${take.index})` : ''}:</p>
            <audio controls src={take.playbackUrl} className="w-full" />
          </div>
        )}

        {(recordError || submitError) && <p className="text-sm text-destructive">{recordError ?? submitError}</p>}

        <SubmitBar
          disabled={!take || isRecording || busy}
          submitting={submitting}
          onSubmit={() => void submit()}
          note="This is your only attempt — record and listen back before submitting."
        />
      </CardContent>
    </Card>
  );
}
