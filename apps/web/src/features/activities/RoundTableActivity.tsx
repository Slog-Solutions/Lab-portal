import { useEffect, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { ActivityEventPayload } from '@lab/shared/events';
import type { StationControlClient } from '../../lib/station-control-client';
import { ActivityRecorder } from '../../lib/activity-recorder';

interface RoundTableConfig {
  topic: string;
  chairmanAssignment: 'manual' | 'automatic';
  micRequestQueueEnabled: boolean;
}

/**
 * Annexure-I Ser 3: chairman-led discussion with a mic-request queue.
 * The chairman's own client is authoritative for who currently has the
 * floor (design doc note in packages/shared/src/events — this is a
 * classroom coordination aid, not a security boundary); other members
 * request the floor and apply whatever the chairman broadcasts. Every
 * member records their own mic locally for the whole activity — no
 * central "the recording" exists, matching the client-side-recording
 * design (§2.6); a teacher reviewing the discussion later plays each
 * member's track.
 */
export function RoundTableActivity({
  control,
  sessionId,
  groupId,
  instanceId,
  stationId,
  role,
  config,
  lastActivityEvent,
}: {
  control: StationControlClient;
  sessionId: string;
  groupId: string;
  instanceId: string;
  stationId: string;
  role: string | null;
  config: RoundTableConfig;
  /** The most recent relayed activity:event for this group — StudentConsole
   * owns the single StationControlClient connection and its onActivityEvent
   * callback, so it forwards events down as a changing prop rather than
   * this component reaching into the client's internals. */
  lastActivityEvent: (ActivityEventPayload & { fromStationId: string }) | null;
}) {
  const isChairman = role === 'CHAIRMAN';
  const [floorHolder, setFloorHolder] = useState<string | null>(isChairman ? stationId : null);
  const [requestQueue, setRequestQueue] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const recorder = new ActivityRecorder(() => control.getToken());
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        await recorder.start(stream, { kind: RecordingKind.GROUP_DISCUSSION, sessionId, activityInstanceId: instanceId, stationId });
        setRecording(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[round-table] mic capture failed — recording unavailable', err);
      });

    return () => {
      void recorder.stop();
      setRecording(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // React to relayed events from other group members (mic requests
  // arriving at the chairman; the chairman's floor decision arriving at
  // everyone else) as they change, rather than polling.
  useEffect(() => {
    if (!lastActivityEvent || lastActivityEvent.groupId !== groupId) return;
    if (lastActivityEvent.type === 'mic_request' && isChairman) {
      const requester = (lastActivityEvent.payload as { stationId: string }).stationId;
      setRequestQueue((prev) => (prev.includes(requester) ? prev : [...prev, requester]));
    } else if (lastActivityEvent.type === 'chairman_pass') {
      setFloorHolder((lastActivityEvent.payload as { stationId: string }).stationId);
    }
  }, [lastActivityEvent, groupId, isChairman]);

  function requestMic(): void {
    control.sendActivityEvent({ sessionId, groupId, type: 'mic_request', payload: { stationId } });
  }

  function grantMic(toStationId: string): void {
    setFloorHolder(toStationId);
    setRequestQueue((prev) => prev.filter((id) => id !== toStationId));
    control.sendActivityEvent({ sessionId, groupId, type: 'chairman_pass', payload: { stationId: toStationId } });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Round Table: {config.topic}</h2>
          <p className="text-xs text-slate-500">{isChairman ? 'You are the chairman' : 'Discussion member'}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${recording ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>
          {recording ? '● Recording' : 'Not recording'}
        </span>
      </div>

      <div className="mb-3 rounded-md bg-slate-950 p-2 text-sm">
        Floor: <span className="font-medium">{floorHolder === stationId ? 'You' : (floorHolder ?? 'Unassigned')}</span>
      </div>

      {!isChairman && config.micRequestQueueEnabled && (
        <button type="button" onClick={requestMic} className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600">
          Request to Speak
        </button>
      )}

      {isChairman && (
        <div>
          <p className="mb-1 text-xs text-slate-400">Requests to speak:</p>
          {requestQueue.length === 0 && <p className="text-xs text-slate-600">None</p>}
          <div className="flex flex-wrap gap-1.5">
            {requestQueue.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => grantMic(id)}
                className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
              >
                Grant floor to {id.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
