import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';

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
 */
export function BroadcastPanel({ isAdmin, classId }: { isAdmin: boolean; classId: string | null }) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<LiveKitRoomClient | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);

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
              setConnected(false);
              setLive(false);
              setMicOn(false);
              roomRef.current = null;
            },
            onLocalScreenShareEnded: () => setLive(false),
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
      void roomRef.current?.disconnect();
      roomRef.current = null;
      setConnected(false);
      setLive(false);
      setMicOn(false);
    };
  }, [connectKey]);

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

  return (
    <div className="mb-6 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <span className={`h-2 w-2 rounded-full ${live ? 'bg-red-500' : connected ? 'bg-emerald-600' : 'bg-slate-600'}`} />
      <span className="text-sm text-slate-300">
        {!connectKey
          ? 'Start a class to broadcast or talk to students'
          : !connected
            ? 'Connecting…'
            : live
              ? 'Broadcasting to class'
              : 'Connected — not broadcasting'}
      </span>
      <div className="ml-auto flex gap-2">
        {!canPlayAudio && (
          <button
            type="button"
            onClick={() => void enableAudio()}
            className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
          >
            Enable audio
          </button>
        )}
        <button
          type="button"
          disabled={!connected}
          onClick={() => void toggleMic()}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${micOn ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {micOn ? 'Mic On' : 'Mic Off'}
        </button>
        {!live ? (
          <button
            type="button"
            disabled={!connected}
            onClick={() => void startBroadcast()}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
          >
            Start Broadcast
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopBroadcast()}
            className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600"
          >
            Stop Broadcast
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div ref={audioContainerRef} className="hidden" />
    </div>
  );
}
