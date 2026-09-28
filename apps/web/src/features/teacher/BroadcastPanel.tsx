import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Track } from 'livekit-client';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { ClassRecorder, type ClassRecorderState } from './class-recorder';

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
              audioContainerRef.current?.appendChild(el);
            },
            onTrackUnsubscribed: (handle) => handle.track.detach().forEach((el) => el.remove()),
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] p-5 text-[#14150F]">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-black/5 ${live ? 'bg-[#C9503F] animate-pulse' : connected ? 'bg-[#6FCF6F]' : 'bg-[#6E7066]'}`} />
        <div>
          <h4 className="text-xs font-semibold text-[#6E7066]">Classroom broadcast &amp; audio intercom</h4>
          <p className="text-sm font-medium text-[#14150F]">
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
            className="rounded-full bg-[#E0B84A] px-3.5 py-1.5 text-xs font-semibold text-[#14150F] transition hover:opacity-90"
          >
            Enable audio
          </button>
        )}
        <button
          type="button"
          disabled={!connected}
          onClick={() => void toggleMic()}
          className={`rounded-full px-4 py-2 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${micOn ? 'bg-[#17181A] text-[#F5F5F0]' : 'border border-[rgba(20,21,15,0.12)] bg-black/5 text-[#14150F] hover:bg-black/10'}`}
        >
          {micOn ? 'Mic on' : 'Mic off'}
        </button>
        {!live ? (
          <button
            type="button"
            disabled={!connected}
            onClick={() => void startBroadcast()}
            className="rounded-full bg-[#17181A] px-4 py-2 text-xs font-semibold text-[#F5F5F0] transition-all hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start broadcast
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopBroadcast()}
            className="rounded-full bg-[#C9503F] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Stop broadcast
          </button>
        )}
      </div>

      {/* Recording — a separate control from the broadcast itself (design
          decision: teacher chooses per-recording, not once at start). */}
      <div className="flex w-full flex-wrap items-center gap-2 border-t border-[rgba(20,21,15,0.08)] pt-3">
        <button
          type="button"
          disabled={isRecording || isSaving}
          onClick={() => setRecordAudio((v) => !v)}
          title="Include your mic and the shared screen's sound in the recording"
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${recordAudio ? 'bg-[#17181A] text-[#F5F5F0]' : 'border border-[rgba(20,21,15,0.12)] bg-black/5 text-[#14150F] hover:bg-black/10'}`}
        >
          {recordAudio ? 'Record audio: on' : 'Record audio: off'}
        </button>

        {!isRecording && !isSaving && (
          <button
            type="button"
            disabled={!live}
            title={!live ? 'Start the broadcast first' : undefined}
            onClick={() => void toggleRecording()}
            className="rounded-full bg-[#C9503F] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ● Record
          </button>
        )}

        {isRecording && (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-[#C9503F]/10 px-3 py-1.5 text-xs font-semibold text-[#C9503F]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#C9503F]" />
              REC {formatElapsed(recorderState.startedAt ?? now, now)}
              {recorderState.pendingChunks > 0 && <span className="text-[#6E7066]">· uploading…</span>}
            </span>
            <button
              type="button"
              onClick={() => void toggleRecording()}
              className="rounded-full border border-[rgba(20,21,15,0.12)] bg-black/5 px-4 py-2 text-xs font-semibold text-[#14150F] transition hover:bg-black/10"
            >
              ■ Stop recording
            </button>
          </>
        )}

        {isSaving && <span className="text-xs font-medium text-[#6E7066]">Saving recording…</span>}

        {recorderState.status === 'saved' && (
          <span className="text-xs font-medium text-[#14150F]">
            Recording saved ·{' '}
            <Link to="/recordings" className="font-semibold underline underline-offset-2">
              View recordings →
            </Link>
          </span>
        )}

        {(recordError || recorderState.error) && <span className="text-xs text-[#C9503F]">{recordError ?? recorderState.error}</span>}

        {isRecording && recordAudio && !micOn && (
          <span className="w-full text-xs text-[#6E7066]">Mic is off — your voice isn't being recorded.</span>
        )}
      </div>

      {error && <p className="w-full text-xs text-[#C9503F]">{error}</p>}
      <div ref={audioContainerRef} className="hidden" />
    </div>
  );
}
