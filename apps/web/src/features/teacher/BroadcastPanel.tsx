import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Track } from 'livekit-client';
import { isTranslatorIdentity, parseTranslationTrackName } from '@lab/shared/events';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { ClassRecorder, type ClassRecorderState } from './class-recorder';
import { TranslationControl } from './TranslationControl';

const IDLE_RECORDER_STATE: ClassRecorderState = { status: 'idle', startedAt: null, pendingChunks: 0, withAudio: true, error: null };

function formatElapsed(startedAt: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

/**
 * Teacher-side publish control for the class broadcast room (Annexure-I
 * Ser 1: "send the instructor's screen, audio, video and text based
 * content to student's consoles") — and the teacher's half of student
 * intercom (Ser 1 "individual/group/whole-class intercom"): every
 * signed-in student publishes their own mic into this same room
 * (SessionStateService's classRoomGrant), so this panel stays connected
 * and playing remote audio for as long as a class is live, independent
 * of whether the teacher is currently sharing a screen.
 *
 * setScreenShareEnabled(true, true) triggers the browser's native
 * getDisplayMedia picker on a plain dashboard machine; inside the real
 * Electron teacher seat it resolves silently via
 * session.setDisplayMediaRequestHandler (apps/desktop/src/main/index.ts).
 *
 * Recording (ClassRecorder) is independent of the broadcast connection
 * itself — a separate Record button, with its own with/without-audio
 * choice, that can be used any time the broadcast is live and stopped
 * (and re-started) as many times as the teacher likes in one class. It is
 * always stopped — never left running — whenever the broadcast itself
 * ends, from any of the four places that can happen below.
 */
export function BroadcastPanel({ isAdmin, classId }: { isAdmin: boolean; classId: string | null }) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordAudio, setRecordAudio] = useState(true);
  const [recorderState, setRecorderState] = useState<ClassRecorderState>(IDLE_RECORDER_STATE);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const roomRef = useRef<LiveKitRoomClient | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  // Which translated language the teacher is auditioning, if any. Held in
  // a ref as well as state because the room's subscription filter runs
  // from the connect-time closure, not a render.
  const [monitorLang, setMonitorLang] = useState<string | null>(null);
  const monitorLangRef = useRef<string | null>(null);
  const recorderRef = useRef<ClassRecorder | null>(null);
  if (!recorderRef.current) recorderRef.current = new ClassRecorder(setRecorderState);

  // An ADMIN always has the lab-wide room to connect to; a TEACHER only
  // has somewhere to connect once their own class is live — connectKey
  // being non-null is exactly "there is a room to join right now".
  const connectKey = isAdmin ? 'admin' : classId;

  useEffect(() => {
    if (!connectKey) return;
    let cancelled = false;
    setError(null);

    async function connect(): Promise<void> {
      try {
        await apiFetch<{ room: string; token: string }>('/media/broadcast-token', { method: 'POST' }).then(async ({ token }) => {
          if (cancelled) return;
          const client = new LiveKitRoomClient({
            onDisconnected: () => {
              void recorderRef.current?.stop();
              setConnected(false);
              setLive(false);
              setMicOn(false);
              roomRef.current = null;
            },
            onLocalScreenShareEnded: () => {
              void recorderRef.current?.stop();
              setLive(false);
            },
            onAudioPlaybackChanged: (canPlay) => setCanPlayAudio(canPlay),
            onTrackSubscribed: (handle) => {
              if (handle.source !== Track.Source.Microphone && handle.source !== Track.Source.ScreenShareAudio) return;
              const el = handle.track.attach();
              el.dataset.participant = handle.participantIdentity;
              el.dataset.trackName = handle.trackName;
              audioContainerRef.current?.appendChild(el);
            },
            onTrackUnsubscribed: (handle) => handle.track.detach().forEach((el) => el.remove()),
            /**
             * Keeps the teacher out of their own translation feedback
             * loop. Without this, every `tr:<lang>` track the translator
             * publishes into this room would auto-play on the teacher's
             * speakers, be picked up by the teacher's own mic, and be fed
             * straight back into the translator — a loop that also
             * poisons every student's translation, not just the teacher's
             * audio. So: translator tracks are subscribed ONLY when the
             * teacher has explicitly asked to monitor that language
             * (which the UI pairs with a headphones warning); everything
             * else in the room — students' mics, screen share — is
             * allowed through exactly as before.
             */
            subscriptionFilter: (info) => {
              if (!isTranslatorIdentity(info.participantIdentity)) return true;
              const lang = parseTranslationTrackName(info.trackName);
              return lang !== null && lang === monitorLangRef.current;
            },
          });
          await client.connect(getLiveKitUrl(), token);
          if (cancelled) {
            void client.disconnect();
            return;
          }
          roomRef.current = client;
          setCanPlayAudio(client.room.canPlaybackAudio);
          setConnected(true);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to connect to the class broadcast room');
      }
    }
    void connect();

    return () => {
      cancelled = true;
      void recorderRef.current?.stop();
      void roomRef.current?.disconnect();
      roomRef.current = null;
      setConnected(false);
      setLive(false);
      setMicOn(false);
    };
  }, [connectKey]);

  // Re-runs the room's subscription filter when the teacher picks a
  // different language to monitor (or stops monitoring), which is what
  // starts streaming that translation and stops the previous one without
  // reconnecting.
  useEffect(() => {
    monitorLangRef.current = monitorLang;
    roomRef.current?.refreshSubscriptions();
  }, [monitorLang]);

  // A ticking display for the REC badge — only runs while actually recording.
  useEffect(() => {
    if (recorderState.status !== 'recording') return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [recorderState.status]);

  async function startBroadcast(): Promise<void> {
    setError(null);
    try {
      await roomRef.current?.setScreenShareEnabled(true, true);
      setLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start broadcast — screen-share permission denied?');
    }
  }

  async function stopBroadcast(): Promise<void> {
    // Stop recording before dropping the screen track, so the last frames
    // captured are the last frames actually shared, not a black tail.
    await recorderRef.current?.stop();
    await roomRef.current?.setScreenShareEnabled(false);
    setLive(false);
  }

  async function toggleMic(): Promise<void> {
    const next = !micOn;
    setError(null);
    try {
      await roomRef.current?.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access the microphone');
    }
  }

  async function enableAudio(): Promise<void> {
    await roomRef.current?.startAudio();
    setCanPlayAudio(true);
  }

  async function toggleRecording(): Promise<void> {
    if (!roomRef.current) return;
    if (recorderRef.current?.isRecording) {
      await recorderRef.current.stop();
      return;
    }
    setRecordError(null);
    try {
      await recorderRef.current?.start(roomRef.current.room, recordAudio);
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }

  const isRecording = recorderState.status === 'recording';
  const isSaving = recorderState.status === 'saving';

  return (
    <div className="flex h-full flex-wrap content-start items-center justify-between gap-3 rounded-card border border-hairline bg-card p-5 text-foreground">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-destructive animate-pulse' : connected ? 'bg-status-online' : 'bg-muted-foreground'}`} />
        <div>
          <h2 className="text-[15px] font-semibold leading-snug text-foreground">Classroom broadcast &amp; intercom</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!connectKey
              ? 'Start a class to broadcast or talk to students'
              : !connected
                ? 'Connecting to broadcast room…'
                : live
                  ? 'Broadcasting active to all consoles'
                  : 'Connected — idle (not broadcasting)'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!canPlayAudio && (
          <button
            type="button"
            onClick={() => void enableAudio()}
            className="rounded-control bg-status-pending px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:opacity-90"
          >
            Enable audio
          </button>
        )}
        <button
          type="button"
          disabled={!connected}
          onClick={() => void toggleMic()}
          className={`rounded-control px-4 py-2 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${micOn ? 'bg-brand text-brand-ink' : 'border border-input bg-card text-foreground hover:bg-accent'}`}
        >
          {micOn ? 'Mic on' : 'Mic off'}
        </button>
        {!live ? (
          <button
            type="button"
            disabled={!connected}
            onClick={() => void startBroadcast()}
            className="rounded-control bg-brand px-4 py-2 text-xs font-semibold text-brand-ink transition-all hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start broadcast
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopBroadcast()}
            className="rounded-control bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground transition hover:opacity-90"
          >
            Stop broadcast
          </button>
        )}
      </div>

      {/* Live translation — only for a real class (the lab-wide ADMIN
          broadcast room has no LiveClass to scope streams or a spoken
          language to, and no roster to compute demand from). */}
      {classId && (
        <TranslationControl classId={classId} monitorLang={monitorLang} onMonitorLangChange={setMonitorLang} />
      )}

      {/* Recording — a separate control from the broadcast itself (design
          decision: teacher chooses per-recording, not once at start). */}
      <div className="flex w-full flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <button
          type="button"
          disabled={isRecording || isSaving}
          onClick={() => setRecordAudio((v) => !v)}
          title="Include your mic and the shared screen's sound in the recording"
          className={`rounded-control px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${recordAudio ? 'bg-brand text-brand-ink' : 'border border-input bg-card text-foreground hover:bg-accent'}`}
        >
          {recordAudio ? 'Record audio: on' : 'Record audio: off'}
        </button>

        {!isRecording && !isSaving && (
          <button
            type="button"
            disabled={!live}
            title={!live ? 'Start the broadcast first' : undefined}
            onClick={() => void toggleRecording()}
            className="rounded-control bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ● Record
          </button>
        )}

        {isRecording && (
          <>
            <span className="flex items-center gap-1.5 rounded-pill bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
              <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
              REC {formatElapsed(recorderState.startedAt ?? now, now)}
              {recorderState.pendingChunks > 0 && <span className="text-muted-foreground">· uploading…</span>}
            </span>
            <button
              type="button"
              onClick={() => void toggleRecording()}
              className="rounded-control border border-input bg-card px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent"
            >
              ■ Stop recording
            </button>
          </>
        )}

        {isSaving && <span className="text-xs font-medium text-muted-foreground">Saving recording…</span>}

        {recorderState.status === 'saved' && (
          <span className="text-xs font-medium text-foreground">
            Recording saved ·{' '}
            <Link to="/recordings" className="font-semibold underline underline-offset-2">
              View recordings →
            </Link>
          </span>
        )}

        {(recordError || recorderState.error) && <span className="text-xs text-destructive">{recordError ?? recorderState.error}</span>}

        {isRecording && recordAudio && !micOn && (
          <span className="w-full text-xs text-muted-foreground">Mic is off — your voice isn't being recorded.</span>
        )}
      </div>

      {error && <p className="w-full text-xs text-destructive">{error}</p>}
      <div ref={audioContainerRef} className="hidden" />
    </div>
  );
}
