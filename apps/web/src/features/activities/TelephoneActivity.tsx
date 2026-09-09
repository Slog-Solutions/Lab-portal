import { useEffect, useState } from 'react';
import { RecordingKind } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { ActivityRecorder } from '../../lib/activity-recorder';

interface TelephoneConfig {
  scenario?: string;
  maxDurationSec: number;
}

/**
 * Annexure-I Ser 6: student-to-student calls. A 2-member group's own
 * room (already connected by StudentConsole's broadcast/group room
 * reconciliation — see design doc §2.2's two-plane model) IS the call;
 * this component adds the scenario prompt, a call timer against
 * maxDurationSec, and per-participant local recording. No separate
 * ephemeral `call:<id>` room is needed here since the session/group
 * mechanism already provisions an isolated 2-person room per Ser 3's
 * "groups" concept.
 */
export function TelephoneActivity({
  control,
  sessionId,
  instanceId,
  stationId,
  config,
}: {
  control: StationControlClient;
  sessionId: string;
  instanceId: string;
  stationId: string;
  config: TelephoneConfig;
}) {
  const [elapsedSec, setElapsedSec] = useState(0);
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
        console.error('[telephone] mic capture failed — recording unavailable', err);
      });

    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);

    return () => {
      clearInterval(timer);
      void recorder.stop();
      setRecording(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const remaining = Math.max(0, config.maxDurationSec - elapsedSec);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-slate-50">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Telephone Activity</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${recording ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>
          {recording ? '● Recording' : 'Not recording'}
        </span>
      </div>
      {config.scenario && <p className="mb-3 text-sm text-slate-300">Scenario: {config.scenario}</p>}
      <div className="font-mono text-2xl text-slate-100">
        {mm}:{ss}
      </div>
      <p className="text-xs text-slate-500">time remaining · use the mic toggle above to talk</p>
    </div>
  );
}
