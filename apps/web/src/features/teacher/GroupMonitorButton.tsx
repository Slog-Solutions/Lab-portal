import { useRef, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { LiveKitRoomClient } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';

/**
 * Ser 3 "Teacher listens in on any group, can join" (Phase 5 — this was
 * the one remaining ⬜ row in that requirement's compliance-matrix entry).
 * Unlike remote-control, joining a group's room to listen needs no
 * coordination with its members at all — the room already exists once the
 * session is armed, and a hidden teacher token just needs canSubscribe on
 * it (ControlController.startGroupMonitor). Every subscribed audio track
 * auto-plays here; this is general oversight, not the interpreting
 * activity's per-channel selection (see ConferenceInterpretingActivity).
 */
export function GroupMonitorButton({ groupId, label }: { groupId: string; label: string }) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<LiveKitRoomClient | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const { token } = await apiFetch<{ room: string; token: string }>(`/control/monitor-group/${groupId}/start`, { method: 'POST' });
      const client = new LiveKitRoomClient({
        onTrackSubscribed: (handle) => {
          const el = handle.track.attach();
          el.dataset.participant = handle.participantIdentity;
          containerRef.current?.appendChild(el);
        },
        onTrackUnsubscribed: (handle) => handle.track.detach().forEach((el) => el.remove()),
      });
      clientRef.current = client;
      await client.connect(getLiveKitUrl(), token);
      setListening(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[group-monitor] failed to join ${groupId}`, err);
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setBusy(true);
    try {
      await clientRef.current?.disconnect();
      clientRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
      await apiFetch(`/control/monitor-group/${groupId}/stop`, { method: 'POST' });
    } finally {
      setListening(false);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void (listening ? stop() : start())}
        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
          listening ? 'bg-red-800 text-white hover:bg-red-700' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        } disabled:opacity-40`}
      >
        {listening ? `⏹ Stop listening — ${label}` : `🎧 Listen — ${label}`}
      </button>
      <div ref={containerRef} className="hidden" />
    </>
  );
}
