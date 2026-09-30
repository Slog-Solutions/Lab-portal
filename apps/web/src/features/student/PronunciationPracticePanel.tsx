import { useEffect, useRef, useState } from 'react';
import { PRONUNCIATION_TEXT_MAX_LENGTH } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { base64ToAudioUrl, type PronunciationVoice } from '../../lib/pronunciation-api';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

interface Heard {
  text: string;
  ipa: string | null;
  audioUrl: string | null;
  warning: string | null;
}

type PracticeExercise = Awaited<ReturnType<typeof stationApi.pronunciationExercises>>[number];

/**
 * Ser 7 student-side pronunciation practice — deliberately not tied to an
 * Assignment, the same open self-study posture as StudyLibraryPanel. Two
 * parts:
 *  1. "Practise any word": type a word, phrase or whole passage (up to
 *     PRONUNCIATION_TEXT_MAX_LENGTH), hear the model voice and see its IPA,
 *     record yourself and play the two back to back. The
 *     student's take stays in this browser (never uploaded) — it is
 *     private practice, not something a teacher will ever see or grade.
 *     Graded pronunciation is the separate teacher-set test
 *     (PronunciationTestPlayer, launched from My Assignments).
 *  2. Teacher-authored pronunciation exercises, launched into the
 *     existing PronunciationPlayer (which does upload + self-rating).
 *
 * Model voice and IPA come from the server's offline eSpeak-NG/Piper
 * pipeline; on a server without it the result carries a warning instead
 * and recording still works.
 */
export function PronunciationPracticePanel({ control }: { control: StationControlClient }) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<PronunciationVoice>('en_GB');
  const [heard, setHeard] = useState<Heard | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [myUrl, setMyUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [exercises, setExercises] = useState<PracticeExercise[] | null>(null);
  const [started, setStarted] = useState<StartedAttempt | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Refs mirror the two object URLs so they can be revoked from anywhere
  // (a new take, a new word, unmount) without a stale-closure read.
  const heardUrlRef = useRef<string | null>(null);
  const myUrlRef = useRef<string | null>(null);

  useEffect(() => {
    stationApi
      .pronunciationExercises(control.getToken())
      .then(setExercises)
      .catch(() => setExercises([]));
  }, [control]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (heardUrlRef.current) URL.revokeObjectURL(heardUrlRef.current);
      if (myUrlRef.current) URL.revokeObjectURL(myUrlRef.current);
    },
    [],
  );

  function clearMyTake(): void {
    if (myUrlRef.current) URL.revokeObjectURL(myUrlRef.current);
    myUrlRef.current = null;
    setMyUrl(null);
  }

  async function listen(): Promise<void> {
    const word = text.trim();
    if (!word || loading || recording) return; // a new word would discard the take in progress
    setError(null);
    setLoading(true);
    try {
      const res = await stationApi.speakPronunciation(control.getToken(), word, voice);
      if (heardUrlRef.current) URL.revokeObjectURL(heardUrlRef.current);
      const audioUrl = res.audioBase64 ? base64ToAudioUrl(res.audioBase64) : null;
      heardUrlRef.current = audioUrl;
      clearMyTake(); // a take recorded against the previous word would be misleading
      setHeard({ text: word, ipa: res.ipa, audioUrl, warning: res.warnings[0] ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the pronunciation');
    } finally {
      setLoading(false);
    }
  }

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const url = URL.createObjectURL(new Blob(chunksRef.current, { type: recorder.mimeType }));
        clearMyTake();
        myUrlRef.current = url;
        setMyUrl(url);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(err instanceof Error ? err.message : 'Microphone access failed');
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function startExercise(exerciseId: string): Promise<void> {
    setError(null);
    try {
      setStarted(await stationApi.startAttempt(control.getToken(), { exerciseId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start exercise');
    }
  }

  if (started) {
    return <PronunciationPlayer control={control} started={started} onDone={() => setStarted(null)} />;
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Pronunciation Practice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Practise any word, phrase or passage</p>
            <span className="text-xs text-muted-foreground">
              {text.length}/{PRONUNCIATION_TEXT_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            value={text}
            maxLength={PRONUNCIATION_TEXT_MAX_LENGTH}
            placeholder="Type a word, phrase or passage, e.g. thorough"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter alone inserts a newline (needed for multi-sentence
              // passages) — Ctrl/Cmd+Enter submits, same shortcut chat and
              // comment boxes use.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void listen();
            }}
            rows={4}
            className="resize-y text-base leading-relaxed"
          />
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              value={voice}
              onChange={(e) => setVoice(e.target.value as PronunciationVoice)}
              aria-label="Voice"
            >
              <option value="en_GB">British</option>
              <option value="en_US">American</option>
            </NativeSelect>
            <Button onClick={() => void listen()} disabled={loading || recording || !text.trim()}>
              {loading ? 'Loading…' : 'Listen'}
            </Button>
          </div>

          {heard && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className={heard.text.length > 60 ? 'text-base leading-relaxed' : 'text-2xl font-semibold'}>{heard.text}</p>
              {heard.ipa && <p className="font-mono text-sm text-muted-foreground">{heard.ipa}</p>}
              {heard.audioUrl ? (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Model voice:</p>
                  <audio controls src={heard.audioUrl} className="w-full" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The model voice isn&apos;t available on this system{heard.warning ? ` — ${heard.warning}` : ''}. You can still record yourself.
                </p>
              )}

              <div className="flex items-center gap-2">
                {!recording ? (
                  <Button variant="destructive" size="sm" onClick={() => void startRecording()}>
                    {myUrl ? 'Record again' : 'Record myself'}
                  </Button>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-sm text-red-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording…
                    </span>
                    <Button variant="secondary" size="sm" onClick={stopRecording}>
                      Stop
                    </Button>
                  </>
                )}
              </div>
              {myUrl && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Your voice (kept on this computer only):</p>
                  <audio controls src={myUrl} className="w-full" />
                </div>
              )}
            </div>
          )}
        </div>

        {exercises && exercises.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Exercises from your teacher</p>
            {exercises.map((ex) => (
              <div key={ex.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ex.title}</p>
                  {ex.sourceText && <p className="truncate text-xs text-muted-foreground">{ex.sourceText}</p>}
                </div>
                <Button size="sm" variant="secondary" onClick={() => void startExercise(ex.id)}>
                  Practise
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
