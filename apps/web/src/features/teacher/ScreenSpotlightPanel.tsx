import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { seatLabel } from '@lab/shared';
import { LiveKitRoomClient, type RemoteTrackHandle } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';

/**
 * Teacher-side preview of a spotlighted student's screen (Ser 1 "broadcast
 * any student's screen to others"). By the time this renders,
 * StatusBoardPage has already called POST /control/promote-screen — the
 * student's screen is already live in `room` — so this component only
 * WATCHES it with a hidden, subscribe-only viewer token, the same
 * hidden-token pattern GroupMonitorButton uses for audio, rendering video
 * instead.
 *
 * A floating panel, not a full-screen takeover like RemoteControlView —
 * the point of a spotlight is that the whole class sees it while the
 * teacher keeps working the seat grid, so this must not block the page.
 */
export function ScreenSpotlightPanel({
  stationId,
  seatNo,
  room,
  viewerToken,
  mic,
  onMicToggle,
  onStop,
}: {
  stationId: string;
  seatNo: number | null;
  room: string;
  viewerToken: string;
  mic: boolean;
  onMicToggle: () => void;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<LiveKitRoomClient | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
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
    void client.connect(getLiveKitUrl(), viewerToken);
    return () => {
      void client.disconnect();
    };
    // A fresh room/viewerToken (re-promoting with a new mic value mints a
    // new token) is a new connection, not a token swap on the old one —
    // same reasoning as RemoteControlView reconnecting per stationId.
  }, [room, viewerToken]);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-lg border border-violet-700/50 bg-slate-900 shadow-xl">
      <header className="flex items-center gap-2 bg-violet-950/60 px-3 py-2 text-xs font-medium text-violet-100">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
        Spotlighting {seatNo !== null ? `System ${seatLabel(seatNo)}` : stationId}
      </header>
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
        {/* Live but not yet publishing is the normal state right after
            promote-screen while the station is still starting its own
            capture — same "waiting, not broken" posture as
            RemoteControlView's own equivalent overlay. */}
        {!sharing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-slate-400">Waiting for the student's screen…</span>
          </div>
        )}
      </div>
      <div className="flex gap-2 p-2">
        <button
          type="button"
          onClick={onMicToggle}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${mic ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {mic ? 'Mic On' : 'Mic Off'}
        </button>
        <button
          type="button"
          onClick={onStop}
          className="ml-auto rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Stop sharing
        </button>
      </div>
    </div>
  );
}
