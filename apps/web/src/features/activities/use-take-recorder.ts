import { useEffect, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { ActivityRecorder } from '../../lib/activity-recorder';

export interface Take {
  recordingId: string;
  playbackUrl: string | null;
  /** 1 for the first take, 2 for the first re-record, and so on. */
  index: number;
}

/**
 * Shared mic-capture plumbing for a "record one take, optionally redo it,
 * then submit" activity — lifted out of PronunciationPlayer (Ser 7) so
 * ReadingTestPlayer doesn't duplicate the getUserMedia/ActivityRecorder/
 * object-URL bookkeeping a third time. PronunciationPlayer and
 * PronunciationTestPlayer keep their own copies of this logic for now —
 * the former also owns a self-rating and pre-generated model-audio fetch,
 * the latter a per-word Record<itemId, WordRecording> map, neither of which
 * maps cleanly onto this single-take shape. Folding those two into this
 * hook is a follow-up, not part of adding the reading test.
 */
export function useTakeRecorder(control: StationControlClient, attemptId: string) {
  const [take, setTake] = useState<Take | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [busy, setBusy] = useState(false); // starting or finishing a take
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const takeIndexRef = useRef(0);
  const currentTakeRef = useRef<Take | null>(null);
  // Every object URL this hook hands out (playback, plus anything the
  // caller tracks via trackUrl e.g. model audio), so unmounting mid-take
  // can't leak them.
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

  async function start(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new ActivityRecorder(() => control.getToken());
      recorderRef.current = recorder;
      await recorder.start(stream, { kind: RecordingKind.PRONUNCIATION, attemptId });
      setIsRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setError(err instanceof Error ? err.message : 'Microphone access failed');
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setBusy(true);
    try {
      const id = await recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      streamRef.current = null;
      setIsRecording(false);
      if (!id) {
        setError('The recording could not be saved. Please try again.');
        return;
      }
      releaseUrl(currentTakeRef.current?.playbackUrl);
      takeIndexRef.current += 1;
      let playbackUrl: string | null = null;
      try {
        playbackUrl = trackUrl(await stationApi.fetchBlobUrl(control.getToken(), `/recordings/${id}/file`));
      } catch {
        // playback is a nicety; submission below doesn't depend on it
      }
      const next: Take = { recordingId: id, playbackUrl, index: takeIndexRef.current };
      currentTakeRef.current = next;
      setTake(next);
    } finally {
      setBusy(false);
    }
  }

  /** Discards the current take and records a fresh one against the same
   * attempt — as many times as the student likes before submitting. */
  async function retake(): Promise<void> {
    setError(null);
    await start();
  }

  return { take, isRecording, busy, error, start, stop, retake, trackUrl };
}
