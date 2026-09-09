import { useEffect, useRef, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import type { LiveKitRoomClient, RemoteTrackHandle } from '../../lib/livekit-client';
import { ActivityRecorder } from '../../lib/activity-recorder';

interface InterpretingRole {
  stationId: string;
  role: 'INTERPRETER' | 'DELEGATE' | 'OBSERVER';
  lang?: string;
}

interface ConferenceInterpretingConfig {
  topic: string;
  languages: string[];
  roles: InterpretingRole[];
}

/**
 * Annexure-I Ser 8: Interpreter/Delegate/Observer roles sharing one room
 * (`mediaRoomForActivity` → `interpretingRoom(sessionId)`, session-wide by
 * design, not per-group — see that helper's own comment), where the
 * listener picks either the floor (the delegate's raw source-language
 * audio) or a specific interpreter's rendered channel. StudentConsole owns
 * the actual LiveKit connection for this room (it's one of
 * DesiredStationState.media.rooms like any other) but deliberately does
 * NOT auto-attach its tracks the way every other room's mic tracks are —
 * that would make every published channel audible at once, defeating the
 * entire point of channel selection — so it hands this component the raw
 * `tracks` map and the room client instead (see registry.tsx/StudentConsole's
 * interpreting-room special case).
 *
 * INTERPRETER and DELEGATE publish their own mic (the delegate's mic *is*
 * the floor channel; each interpreter's mic *is* their language channel)
 * and record it locally via the same ActivityRecorder pipeline every
 * other activity uses, closing Ser 8's "interpretation recordings
 * collected" row. OBSERVER (and any station this session's role
 * assignment didn't cover) is listen-only.
 */
export function ConferenceInterpretingActivity({
  control,
  sessionId,
  stationId,
  role,
  config,
  roomClient,
  tracks,
}: {
  control: StationControlClient;
  sessionId: string;
  groupId: string;
  instanceId: string;
  stationId: string;
  role: string | null;
  config: ConferenceInterpretingConfig;
  roomClient: LiveKitRoomClient | null;
  tracks: Map<string, RemoteTrackHandle>;
}) {
  const isSpeaker = role === 'INTERPRETER' || role === 'DELEGATE';
  const [selected, setSelected] = useState<string | null>(null); // a roles[].stationId, or null
  const [publishing, setPublishing] = useState(false);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<ActivityRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const delegate = config.roles.find((r) => r.role === 'DELEGATE');
  const interpreters = config.roles.filter((r) => r.role === 'INTERPRETER');

  // Publish + record this station's own mic if it's a speaking role
  // (interpreter or delegate). Independent of channel selection below —
  // a speaker doesn't have to be listening to anyone to be heard.
  useEffect(() => {
    if (!isSpeaker || !roomClient) return;
    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
        await roomClient.setMicrophoneEnabled(true);
        const recorder = new ActivityRecorder(() => control.getToken());
        recorderRef.current = recorder;
        await recorder.start(stream, { kind: RecordingKind.INTERPRETATION, sessionId, stationId });
        setPublishing(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[conference-interpreting] mic capture failed — cannot publish/record this channel', err);
      }
    })();
    return () => {
      cancelled = true;
      void recorderRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      void roomClient?.setMicrophoneEnabled(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaker, roomClient]);

  // Channel selection: attach exactly the chosen participant's track,
  // detaching whatever was attached before — the whole point is that
  // only one channel plays at a time.
  useEffect(() => {
    const container = audioContainerRef.current;
    if (!container) return;
    container.innerHTML = '';
    if (!selected) return;
    const handle = tracks.get(`st:${selected}`);
    if (!handle) return;
    const el = handle.track.attach();
    container.appendChild(el);
    control.sendInterpSelectChannel({ sessionId, trackSid: handle.track.sid ?? '' });
    return () => {
      handle.track.detach(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tracks]);

  function channelAvailable(channelStationId: string | undefined): boolean {
    return Boolean(channelStationId && tracks.has(`st:${channelStationId}`));
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Conference Interpreting: {config.topic}</h2>
          <p className="text-xs text-slate-500">
            You are {role === 'INTERPRETER' ? 'an interpreter' : role === 'DELEGATE' ? 'the delegate (floor)' : 'an observer'}
          </p>
        </div>
        {isSpeaker && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${publishing ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>
            {publishing ? '● Live & recording' : 'Connecting…'}
          </span>
        )}
      </div>

      {!isSpeaker && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-slate-400">Choose what to listen to:</p>
          <div className="flex flex-wrap gap-1.5">
            {delegate && (
              <ChannelButton
                label="Floor (original)"
                active={selected === delegate.stationId}
                available={channelAvailable(delegate.stationId)}
                onClick={() => setSelected(delegate.stationId)}
              />
            )}
            {interpreters.map((interp) => (
              <ChannelButton
                key={interp.stationId}
                label={`Interpreter — ${interp.lang ?? '?'}`}
                active={selected === interp.stationId}
                available={channelAvailable(interp.stationId)}
                onClick={() => setSelected(interp.stationId)}
              />
            ))}
            {!delegate && interpreters.length === 0 && <span className="text-xs text-slate-600">No channels configured yet.</span>}
          </div>
        </div>
      )}

      <div ref={audioContainerRef} />
    </div>
  );
}

function ChannelButton({ label, active, available, onClick }: { label: string; active: boolean; available: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available}
      title={available ? undefined : 'This channel has not joined yet'}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        active ? 'bg-emerald-700 text-white' : available ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-950 text-slate-700'
      }`}
    >
      {available ? '' : '○ '}
      {label}
    </button>
  );
}
