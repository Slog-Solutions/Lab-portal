import { useRef, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';

/**
 * Teacher-side publish control for lab:broadcast (Annexure-I Ser 1: "send
 * the instructor's screen, audio, video and text based content to
 * student's consoles"). setScreenShareEnabled(true) triggers the
 * browser's native getDisplayMedia picker on a plain dashboard machine;
 * inside the real Electron student/teacher seat it resolves silently via
 * session.setDisplayMediaRequestHandler (apps/desktop/src/main/index.ts).
 */
export function BroadcastPanel() {
  const [live, setLive] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<LiveKitRoomClient | null>(null);

  async function startBroadcast(): Promise<void> {
    setError(null);
    try {
      const { room, token } = await apiFetch<{ room: string; token: string }>('/media/broadcast-token', { method: 'POST' });
      const client = new LiveKitRoomClient({
        onDisconnected: () => {
          setLive(false);
          roomRef.current = null;
        },
      });
      await client.connect(getLiveKitUrl(), token);
      await client.setScreenShareEnabled(true);
      roomRef.current = client;
      setLive(true);
      void room; // room name is fixed (lab:broadcast) — kept for clarity in the response shape
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start broadcast — screen-share permission denied?');
    }
  }

  async function stopBroadcast(): Promise<void> {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setLive(false);
    setMicOn(false);
  }

  async function toggleMic(): Promise<void> {
    const next = !micOn;
    await roomRef.current?.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  return (
    <div className="mb-6 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <span className={`h-2 w-2 rounded-full ${live ? 'bg-red-500' : 'bg-slate-600'}`} />
      <span className="text-sm text-slate-300">{live ? 'Broadcasting to class' : 'Not broadcasting'}</span>
      <div className="ml-auto flex gap-2">
        {!live ? (
          <button
            type="button"
            onClick={() => void startBroadcast()}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
          >
            Start Broadcast
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void toggleMic()}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${micOn ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              {micOn ? 'Mic On' : 'Mic Off'}
            </button>
            <button
              type="button"
              onClick={() => void stopBroadcast()}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600"
            >
              Stop Broadcast
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
