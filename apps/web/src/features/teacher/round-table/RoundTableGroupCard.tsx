import { useState } from 'react';
import { Ear, Mic, MicOff, Radio } from 'lucide-react';
import { seatLabel, type RoundTableFloor } from '@lab/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { mmss, useNow } from '../../../lib/use-now';
import type { RoundTableGroupOverview } from '../../../lib/round-table-api';

type Member = RoundTableGroupOverview['members'][number];

const seat = (m: Member | undefined) => (m ? `Seat ${seatLabel(m.seatNo)}` : 'Unknown seat');
const who = (m: Member | undefined) => (m ? `${seat(m)}${m.studentName ? ` · ${m.studentName}` : ''}` : 'nobody');

/**
 * One Round Table group on the teacher monitor (Ser 3, spec 7.2): who chairs,
 * who has the floor and for how long, the queue, and per-group actions.
 * Speaking dots are live only for the group whose room this teacher is
 * connected to (`listening`) — a LiveKit connection is what reports voice
 * activity, and being connected to a room is visible to its students, so the
 * monitor never pre-connects to groups the teacher has not chosen.
 */
export function RoundTableGroupCard({
  group,
  floor,
  sessionState,
  listening,
  speakers,
  busy,
  micPermitted,
  alert,
  error,
  onListen,
  onStopListening,
  onParticipate,
  onLeave,
  onGrant,
  onRevoke,
  onChairman,
  onMuteAll,
}: {
  group: RoundTableGroupOverview;
  floor: RoundTableFloor | null;
  sessionState: string;
  listening: boolean;
  speakers: Set<string>;
  busy: boolean;
  micPermitted: boolean;
  alert: { kind: 'chairman_offline' | 'chairman_promoted'; stationId: string } | null;
  error: string | null;
  onListen: () => void;
  onStopListening: () => void;
  onParticipate: () => void;
  onLeave: () => void;
  onGrant: (stationId: string) => void;
  onRevoke: () => void;
  onChairman: (stationId: string) => void;
  onMuteAll: () => void;
}) {
  const [grantTo, setGrantTo] = useState('');
  const [newChair, setNewChair] = useState('');
  const byId = new Map(group.members.map((m) => [m.stationId, m]));
  const live = !!floor && floor.phase !== 'ARMED';
  const running = floor?.phase === 'RUNNING';
  const turnNow = useNow(!!floor?.turnStartedAt);
  const turnMs = floor?.turnStartedAt ? turnNow - floor.turnStartedAt : 0;
  const over = !!group.config?.maxTurnSec && !!floor?.speakerStationId && turnMs > group.config.maxTurnSec * 1000;
  const speaking = listening && floor?.teacher === 'speaking';
  const otherTeacher = !listening && floor && floor.teacher !== 'absent';
  const nonChair = group.members.filter((m) => m.stationId !== floor?.chairmanStationId);

  return (
    <Card data-testid={`rt-card-${group.index}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">
            Group {group.index} <span className="font-normal text-muted-foreground">· {group.topic}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            {floor && <Badge variant={running ? 'success' : 'secondary'}>{floor.phase === 'RUNNING' ? 'Running' : floor.phase === 'PAUSED' ? 'Paused' : 'Armed'}</Badge>}
            {listening && (
              <Badge variant={speaking ? 'warning' : 'outline'} className="gap-1">
                {speaking ? <Mic className="h-3 w-3" /> : <Ear className="h-3 w-3" />}
                {speaking ? 'You are speaking' : 'You are listening'}
              </Badge>
            )}
            {otherTeacher && <Badge variant="outline">Another instructor is here</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {alert?.kind === 'chairman_offline' && (
          <div data-testid="rt-alert-offline" className="rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-amber-100">
            Chairman disconnected — reassign? The discussion is frozen until you pick a new chairman below.
          </div>
        )}
        {alert?.kind === 'chairman_promoted' && (
          <div className="rounded-md border border-sky-700/50 bg-sky-950/40 px-3 py-2 text-sky-100">
            {who(byId.get(alert.stationId))} was made chairman automatically (the previous chairman was offline).
          </div>
        )}
        {error && <div className="rounded-md bg-destructive/15 px-3 py-2 text-destructive">{error}</div>}

        {floor ? (
          <div className="space-y-1 rounded-md bg-muted/40 p-3">
            <p>
              <span className="text-muted-foreground">Chairman:</span> {who(byId.get(floor.chairmanStationId))}
              {floor.chairmanOffline && <Badge variant="warning" className="ml-2">offline</Badge>}
            </p>
            <p data-testid={`rt-speaker-${group.index}`} className={over ? 'text-amber-400' : ''}>
              <span className="text-muted-foreground">Speaking:</span>{' '}
              {floor.speakerStationId ? `${who(byId.get(floor.speakerStationId))} · ${mmss(turnMs)}${over ? ' — over the limit' : ''}` : 'no one'}
            </p>
            <p>
              <span className="text-muted-foreground">Queue:</span>{' '}
              {floor.queue.length === 0 ? 'empty' : floor.queue.map((id, i) => `${i + 1}. ${seat(byId.get(id))}`).join('  ')}
            </p>
          </div>
        ) : (
          <p className="rounded-md bg-muted/40 p-3 text-muted-foreground">
            {sessionState === 'DRAFT' ? 'Arm the session to start this group.' : 'This discussion is not live.'}
          </p>
        )}

        <ul className="grid gap-1 sm:grid-cols-2">
          {group.members.map((m) => {
            const isChair = m.stationId === floor?.chairmanStationId;
            const isSpeaker = m.stationId === floor?.speakerStationId;
            const talking = listening && speakers.has(`st:${m.stationId}`);
            return (
              <li key={m.stationId} className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${isSpeaker ? 'bg-emerald-950/50 ring-1 ring-emerald-700' : 'bg-muted/30'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${talking ? 'animate-pulse bg-emerald-400' : m.online ? 'bg-muted-foreground/40' : 'bg-red-500/70'}`} title={m.online ? 'online' : 'offline'} />
                  <span className="truncate">{who(m)}</span>
                </span>
                {isChair && <Badge variant="warning">Chairman</Badge>}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          {listening ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onStopListening}>
              <MicOff className="h-4 w-4" /> Stop listening
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy || !live} onClick={onListen}>
              <Ear className="h-4 w-4" /> Listen
            </Button>
          )}
          {speaking ? (
            <Button size="sm" variant="destructive" disabled={busy} onClick={onLeave}>
              Leave discussion
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !live || sessionState === 'ARMED'} onClick={onParticipate}>
              <Mic className="h-4 w-4" /> Join discussion
            </Button>
          )}
          {speaking && !micPermitted && (
            <span className="text-xs text-muted-foreground">
              <Radio className="mr-1 inline h-3 w-3" />
              connecting mic…
            </span>
          )}
          {listening && !speaking && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onLeave}>
              Leave
            </Button>
          )}
        </div>

        {running && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <select aria-label="Give floor to" value={grantTo} onChange={(e) => setGrantTo(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Give floor to…</option>
              {nonChair.map((m) => (
                <option key={m.stationId} value={m.stationId}>
                  {who(m)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy || !grantTo}
              onClick={() => {
                onGrant(grantTo);
                setGrantTo('');
              }}
            >
              Give floor
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !floor?.speakerStationId} onClick={onRevoke}>
              Take floor back
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onMuteAll}>
              Mute all
            </Button>
          </div>
        )}
        {live && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Change chairman" value={newChair} onChange={(e) => setNewChair(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Change chairman…</option>
              {nonChair.map((m) => (
                <option key={m.stationId} value={m.stationId}>
                  {who(m)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !newChair}
              onClick={() => {
                onChairman(newChair);
                setNewChair('');
              }}
            >
              Make chairman
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
