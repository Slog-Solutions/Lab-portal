import { useEffect, useMemo, useState } from 'react';
import { Eye, Mic, MicOff, Radio, UserRound } from 'lucide-react';
import { RecordingKind, seatLabel, type RoundTableFloor, type RoundTableMember, type RoundTableView } from '@lab/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StationControlClient } from '../../lib/station-control-client';
import type { LiveKitRoomClient } from '../../lib/livekit-client';
import { ActivityRecorder } from '../../lib/activity-recorder';
import { mmss, useNow } from '../../lib/use-now';

/** What StudentConsole hands the player: the authoritative floor, the roster,
 * and this seat's live LiveKit connection to the group room. */
export interface RoundTableLive {
  view: RoundTableView;
  /** Highest-`seq` floor seen (snapshot or rt:floor); stale updates are dropped upstream. */
  floor: RoundTableFloor;
  client: LiveKitRoomClient | null;
  /** LiveKit identities (`st:<stationId>`) currently heard speaking. */
  speakers: Set<string>;
  /** The server has granted THIS seat the right to publish a mic right now. */
  micPermitted: boolean;
  /** The last refused action, if recent ("Only the chairman can give the floor"). */
  error: string | null;
}

export interface RoundTableConfigView {
  topic: string;
  micRequestQueueEnabled?: boolean;
  maxTurnSec?: number;
}

function seatText(m: RoundTableMember | undefined, fallbackId: string): string {
  return m ? `Seat ${seatLabel(m.seatNo)}` : `Seat ${fallbackId.slice(0, 4)}`;
}

/**
 * Annexure-I Ser 3 Round Table. The SERVER owns the floor: this component
 * only reflects it and asks (request / grant / yield). Your microphone is
 * opened only while the server-published floor AND LiveKit's own permission
 * both say you may speak, so a member who does not hold the floor simply
 * sees "Waiting for the floor" — never a broken-mic error. Rendered purely
 * from `live`, so a reconnecting seat shows the right state straight away.
 */
export function RoundTablePlayer({
  control,
  sessionId,
  groupId,
  instanceId,
  stationId,
  config,
  live,
}: {
  control: StationControlClient;
  sessionId: string;
  groupId: string;
  instanceId: string;
  stationId: string;
  config: RoundTableConfigView;
  live: RoundTableLive | null;
}) {
  const ref = useMemo(() => ({ sessionId, groupId }), [sessionId, groupId]);
  const floor = live?.floor ?? null;
  const running = floor?.phase === 'RUNNING';
  const iAmChair = floor?.chairmanStationId === stationId;
  const iHaveFloor = floor?.speakerStationId === stationId;
  const mayTalk = running && (iAmChair || iHaveFloor);
  const [selfMuted, setSelfMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const wantMic = mayTalk && !!live?.micPermitted && !selfMuted;
  const turnNow = useNow(!!floor?.turnStartedAt);

  // Mic follows the floor. Turning it off is silent — when the server
  // revokes the right, LiveKit has already unpublished the track.
  const client = live?.client ?? null;
  useEffect(() => {
    if (!client) return;
    client.setMicrophoneEnabled(wantMic).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[round-table] mic state change ignored', err);
    });
  }, [wantMic, client]);

  // The chairman talks continuously, so the server times their turns from
  // voice activity — we only report it (the server stamps the time).
  const iSpeak = live?.speakers.has(`st:${stationId}`) ?? false;
  useEffect(() => {
    if (iAmChair && running) control.rtChairSpeaking(ref, iSpeak && wantMic);
  }, [iAmChair, running, iSpeak, wantMic, control, ref]);

  // Every seat records its own mic while the discussion runs (client-side
  // recording by design — no central recorder exists, see §2.6); a paused
  // discussion closes that segment and resume opens a new one.
  useEffect(() => {
    if (!running) return;
    const recorder = new ActivityRecorder(() => control.getToken());
    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        await recorder.start(stream, { kind: RecordingKind.GROUP_DISCUSSION, sessionId, activityInstanceId: instanceId, stationId });
        setRecording(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[round-table] mic capture failed — recording unavailable', err);
      });
    return () => {
      cancelled = true;
      void recorder.stop();
      setRecording(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, running]);

  if (!live || !floor) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Round Table: {config.topic} — waiting for the discussion to be set up…
      </div>
    );
  }

  const members = live.view.members;
  const byId = new Map(members.map((m) => [m.stationId, m]));
  const queue = floor.queue;
  const myQueuePos = queue.indexOf(stationId);
  const turnMs = floor.turnStartedAt ? turnNow - floor.turnStartedAt : 0;
  const overTime = !!config.maxTurnSec && floor.speakerStationId !== null && turnMs > config.maxTurnSec * 1000;
  const queueEnabled = config.micRequestQueueEnabled !== false;
  const nameOf = (id: string) => (id === stationId ? 'You' : seatText(byId.get(id), id));
  const canAct = running && !floor.chairmanOffline;

  return (
    <div data-testid="round-table" className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Round Table: {config.topic}</h2>
          <p data-testid="rt-status" className="text-xs text-muted-foreground">
            Chairman: {nameOf(floor.chairmanStationId)} · Speaking: {floor.speakerStationId ? nameOf(floor.speakerStationId) : 'no one'}
          </p>
        </div>
        <Badge variant={recording ? 'destructive' : 'secondary'} className="shrink-0 gap-1">
          <Radio className="h-3 w-3" />
          {recording ? 'Recording' : 'Not recording'}
        </Badge>
      </div>

      {floor.teacher !== 'absent' && (
        <div data-testid="rt-teacher-banner" className="flex items-center gap-2 rounded-md border border-sky-700/50 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
          {floor.teacher === 'speaking' ? <Mic className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {floor.teacher === 'speaking' ? 'Teacher has joined' : 'Teacher is listening'}
        </div>
      )}
      {floor.phase === 'ARMED' && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">The discussion has not started yet.</p>}
      {floor.phase === 'PAUSED' && <p className="rounded-md bg-amber-950/40 px-3 py-2 text-sm text-amber-100">The discussion is paused.</p>}
      {floor.chairmanOffline && (
        <p className="rounded-md bg-amber-950/40 px-3 py-2 text-sm text-amber-100">The chairman is disconnected — waiting for your instructor.</p>
      )}

      <div data-testid="rt-me" className="rounded-md bg-muted/50 p-3 text-sm">
        {iAmChair ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">You are the chairman{wantMic ? ' — your mic is live' : selfMuted ? ' — you are muted' : ''}</span>
            <Button size="sm" variant="secondary" onClick={() => setSelfMuted((v) => !v)}>
              {selfMuted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {selfMuted ? 'Unmute' : 'Mute'}
            </Button>
          </div>
        ) : iHaveFloor ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-emerald-400">You have the floor</p>
              <p className={`text-xs ${overTime ? 'font-medium text-amber-400' : 'text-muted-foreground'}`}>
                {mmss(turnMs)}
                {config.maxTurnSec ? ` / ${mmss(config.maxTurnSec * 1000)}` : ''}
              </p>
            </div>
            <Button size="sm" onClick={() => control.rtYieldFloor(ref)}>
              Done speaking
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted-foreground">
              <MicOff className="h-4 w-4" />
              Waiting for the floor{myQueuePos >= 0 ? ` — you're ${ordinal(myQueuePos + 1)} in line` : ''}
            </span>
            {queueEnabled && canAct && (
              <Button size="sm" variant={myQueuePos >= 0 ? 'outline' : 'default'} onClick={() => (myQueuePos >= 0 ? control.rtCancelRequest(ref) : control.rtRequestMic(ref))}>
                {myQueuePos >= 0 ? 'Cancel request' : 'Request to speak'}
              </Button>
            )}
          </div>
        )}
        {live.error && <p data-testid="rt-error" className="mt-2 text-xs text-destructive">{live.error}</p>}
      </div>

      {iAmChair && (
        <div data-testid="rt-chair-panel" className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {floor.speakerStationId ? (
                <span className={overTime ? 'text-amber-400' : ''}>
                  {nameOf(floor.speakerStationId)} is speaking · {mmss(turnMs)}
                  {overTime ? ' — over the time limit' : ''}
                </span>
              ) : (
                'Nobody has the floor'
              )}
            </p>
            <Button size="sm" variant="outline" disabled={!floor.speakerStationId || !canAct} onClick={() => control.rtRevokeFloor(ref)}>
              Take floor back
            </Button>
          </div>
          {queueEnabled && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Requests to speak</p>
              {queue.length === 0 && <p className="text-xs text-muted-foreground/70">None</p>}
              <ol className="space-y-1">
                {queue.map((id, i) => (
                  <li key={id} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-sm">
                    <span>
                      {i + 1}. {nameOf(id)}
                      {byId.get(id)?.studentName ? <span className="text-muted-foreground"> · {byId.get(id)?.studentName}</span> : null}
                    </span>
                    <Button size="sm" disabled={!canAct} onClick={() => control.rtGrantFloor(ref, id)}>
                      Give floor
                    </Button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <UserRound className="h-3 w-3" /> Participants ({members.length})
        </p>
        <ul data-testid="rt-roster" className="space-y-1">
          {members.map((m) => {
            const isChair = m.stationId === floor.chairmanStationId;
            const isSpeaker = m.stationId === floor.speakerStationId;
            const pos = queue.indexOf(m.stationId);
            const talking = live.speakers.has(`st:${m.stationId}`);
            return (
              <li
                key={m.stationId}
                data-station={m.stationId}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${isSpeaker ? 'bg-emerald-950/50 ring-1 ring-emerald-700' : 'bg-muted/40'}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${talking ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground/30'}`} aria-label={talking ? 'speaking' : 'quiet'} />
                  <span className="font-medium">{m.stationId === stationId ? 'You' : seatText(m, m.stationId)}</span>
                  {m.studentName && <span className="truncate text-muted-foreground">{m.studentName}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {isChair && <Badge variant="warning">Chairman</Badge>}
                  {isSpeaker && <Badge variant="success">Speaking</Badge>}
                  {pos >= 0 && <Badge variant="outline">#{pos + 1} in queue</Badge>}
                  {iAmChair && !isChair && !isSpeaker && canAct && (
                    <Button size="sm" variant="outline" onClick={() => control.rtGrantFloor(ref, m.stationId)}>
                      Give floor
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
