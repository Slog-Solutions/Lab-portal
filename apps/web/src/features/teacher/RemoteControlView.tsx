import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { REMOTE_CONTROL_DATA_TOPIC, type RemoteInputEvent } from '@lab/shared/events';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient, type RemoteTrackHandle } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { codeToNutKeyName } from '../../lib/keycode-map';

const textEncoder = new TextEncoder();

/**
 * Teacher-side view + control for one student's screen (design doc §3.4,
 * Annexure-I "take remote control of student computer"). Connects to the
 * dedicated ctrl:<stationId> room (only this teacher holds a token for
 * it — cryptographic isolation from every other student, not a
 * client-side convention), subscribes to the student's screen, and
 * captures mouse/keyboard on the video element to publish as
 * RemoteInputEvents. Replay itself happens on the student's machine via
 * nut.js (packages/native-bridge) — this component only ever sends
 * events, never touches the OS locally.
 */
export function RemoteControlView({ stationId, onClose }: { stationId: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<LiveKitRoomClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only a start that actually completed owns a session to close —
    // the server reference-counts concurrent starts per station
    // (RemoteControlSessionService), but a stop with no matching start
    // is still wasted work and a pointless audit entry (e.g. React
    // StrictMode's mount/mount/cleanup-of-first-mount in dev, where the
    // first mount's cleanup would otherwise race the second mount's
    // still-in-flight start).
    let started = false;

    async function start(): Promise<void> {
      try {
        const { room, teacherToken } = await apiFetch<{ room: string; teacherToken: string }>(
          `/control/remote-control/${stationId}/start`,
          { method: 'POST' },
        );
        started = true;
        if (cancelled) return;
        const client = new LiveKitRoomClient({
          onTrackSubscribed: (handle: RemoteTrackHandle) => {
            if (handle.source === Track.Source.ScreenShare && videoRef.current) {
              handle.track.attach(videoRef.current);
              setSharing(true);
            }
          },
          onTrackUnsubscribed: (handle: RemoteTrackHandle) => {
            if (handle.source === Track.Source.ScreenShare) setSharing(false);
          },
        });
        roomRef.current = client;
        await client.connect(getLiveKitUrl(), teacherToken);
        void room; // room name fixed server-side; kept for clarity only
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start remote control');
      }
    }
    void start();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
      if (started) void apiFetch(`/control/remote-control/${stationId}/stop`, { method: 'POST' }).catch(() => {});
    };
  }, [stationId]);

  function send(event: RemoteInputEvent, reliable: boolean): void {
    void roomRef.current?.publishData(textEncoder.encode(JSON.stringify(event)), REMOTE_CONTROL_DATA_TOPIC, reliable);
  }

  function normalizedFromMouseEvent(e: React.MouseEvent<HTMLVideoElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLVideoElement>): void {
    const { x, y } = normalizedFromMouseEvent(e);
    send({ kind: 'move', x, y }, false); // unreliable — high-rate, design doc §3.4
  }

  function handleMouseDown(e: React.MouseEvent<HTMLVideoElement>): void {
    const { x, y } = normalizedFromMouseEvent(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    send({ kind: 'click', x, y, button, down: true }, true);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLVideoElement>): void {
    const { x, y } = normalizedFromMouseEvent(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    send({ kind: 'click', x, y, button, down: false }, true);
  }

  function handleWheel(e: React.WheelEvent<HTMLVideoElement>): void {
    send({ kind: 'scroll', deltaX: Math.sign(e.deltaX), deltaY: Math.sign(e.deltaY) }, true);
  }

  function handleKey(e: React.KeyboardEvent<HTMLVideoElement>, down: boolean): void {
    e.preventDefault();
    const keyName = codeToNutKeyName(e.code);
    if (keyName) send({ kind: 'key', keyName, down }, true);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <header className="flex items-center gap-3 bg-slate-900 px-4 py-2 text-sm text-slate-200">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        Remote control — station {stationId}
        {error && <span className="text-red-400">{error}</span>}
        <button type="button" onClick={onClose} className="ml-auto rounded-md bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">
          Close
        </button>
      </header>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* tabIndex makes the video element focusable so onKeyDown/onKeyUp fire */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          tabIndex={0}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={handleWheel}
          onKeyDown={(e) => handleKey(e, true)}
          onKeyUp={(e) => handleKey(e, false)}
          className="max-h-full max-w-full cursor-crosshair rounded-md bg-slate-950 outline-none"
        />
        {/* connected-but-not-yet-sharing otherwise renders as an
            unexplained black rectangle — this is the normal state right
            after connect while the station is still starting its own
            screen capture, not an error. */}
        {connected && !sharing && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-slate-900/80 px-4 py-2 text-sm text-slate-300">
              Waiting for the station to share its screen…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
