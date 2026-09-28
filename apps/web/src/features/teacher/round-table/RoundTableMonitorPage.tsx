import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoundTableFloor } from '@lab/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LiveKitRoomClient } from '../../../lib/livekit-client';
import { getLiveKitUrl } from '../../../lib/runtime-config';
import { getControlSocket } from '../../../lib/socket-client';
import { queryKeys } from '../../../lib/query-keys';
import { roundTableApi } from '../../../lib/round-table-api';
import { RoundTableGroupCard } from './RoundTableGroupCard';
import { RoundTableReview } from './RoundTableReview';

type GroupAlert = { kind: 'chairman_offline' | 'chairman_promoted'; stationId: string };

/**
 * Teacher monitor for one session's Round Table groups (Ser 3, spec 7.2):
 * live floors over the control socket (`rt:watch`), plus listen-in and
 * participate over LiveKit.
 *
 * Audio: this page owns exactly ONE LiveKit connection. Switching groups
 * disconnects the old room before connecting the new one, so two groups'
 * audio can never mix — and the server independently keeps a teacher in at
 * most one group (RoundTableService.listen). The teacher is never hidden:
 * the group's students see "Teacher is listening" / "Teacher has joined".
 */
export function RoundTableMonitorPage() {
  const { sessionId = '' } = useParams();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: queryKeys.roundTable(sessionId),
    queryFn: () => roundTableApi.overview(sessionId),
    refetchInterval: 15_000,
  });
  const [floors, setFloors] = useState<Record<string, RoundTableFloor>>({});
  const [alerts, setAlerts] = useState<Record<string, GroupAlert>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const clientRef = useRef<LiveKitRoomClient | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const listeningRef = useRef<string | null>(null);
  const [listeningGroup, setListeningGroup] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  const [micPermitted, setMicPermitted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // Live floors for every group of this session. Stale (lower seq) updates are dropped.
  useEffect(() => {
    const socket = getControlSocket();
    const watch = () => socket.emit('rt:watch', { sessionId });
    const onFloor = (f: RoundTableFloor) =>
      setFloors((prev) => (prev[f.groupId] && f.seq < prev[f.groupId]!.seq ? prev : { ...prev, [f.groupId]: f }));
    const onAlert = (a: { sessionId: string; groupId: string; kind: GroupAlert['kind']; stationId: string }) => {
      if (a.sessionId !== sessionId) return;
      setAlerts((prev) => ({ ...prev, [a.groupId]: { kind: a.kind, stationId: a.stationId } }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.roundTable(sessionId) });
    };
    socket.on('rt:floor', onFloor);
    socket.on('rt:alert', onAlert);
    socket.on('connect', watch);
    if (socket.connected) watch();
    return () => {
      socket.off('rt:floor', onFloor);
      socket.off('rt:alert', onAlert);
      socket.off('connect', watch);
      socket.emit('rt:unwatch', { sessionId });
    };
  }, [sessionId, queryClient]);

  // Leaving the page must not leave the teacher in a group room.
  useEffect(
    () => () => {
      const group = listeningRef.current;
      void clientRef.current?.disconnect();
      if (group) void roundTableApi.leave(sessionId, group).catch(() => undefined);
    },
    [sessionId],
  );

  const groups = overview.data?.groups ?? [];
  const floorOf = (groupId: string): RoundTableFloor | null => floors[groupId] ?? groups.find((g) => g.groupId === groupId)?.floor ?? null;
  const listeningFloor = listeningGroup ? floorOf(listeningGroup) : null;
  const wantMic = listeningFloor?.teacher === 'speaking' && micPermitted;
  useEffect(() => {
    clientRef.current?.setMicrophoneEnabled(wantMic).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[round-table] teacher mic change ignored', err);
    });
  }, [wantMic]);

  async function disconnectAudio(): Promise<void> {
    const client = clientRef.current;
    clientRef.current = null;
    listeningRef.current = null;
    setListeningGroup(null);
    setSpeakers(new Set());
    setMicPermitted(false);
    if (audioRef.current) audioRef.current.innerHTML = '';
    await client?.disconnect();
  }

  async function act(groupId: string, action: () => Promise<unknown>): Promise<void> {
    setBusyGroup(groupId);
    setErrors((prev) => ({ ...prev, [groupId]: '' }));
    try {
      await action();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [groupId]: (err as Error).message }));
    } finally {
      setBusyGroup(null);
    }
  }

  /** Listen to one group. Any other group's audio is disconnected FIRST. */
  async function startListening(groupId: string): Promise<void> {
    await disconnectAudio();
    const join = await roundTableApi.listen(sessionId, groupId);
    const client: LiveKitRoomClient = new LiveKitRoomClient({
      onTrackSubscribed: (handle) => {
        const el = handle.track.attach();
        el.dataset.participant = handle.participantIdentity;
        audioRef.current?.appendChild(el);
      },
      onTrackUnsubscribed: (handle) => handle.track.detach().forEach((el) => el.remove()),
      onActiveSpeakersChanged: (ids) => setSpeakers(new Set(ids)),
      onLocalPermissionsChanged: (can) => setMicPermitted(can),
      onAudioPlaybackChanged: (can) => setAudioBlocked(!can),
      onDisconnected: () => {
        if (clientRef.current === client) void disconnectAudio();
      },
    });
    clientRef.current = client;
    listeningRef.current = groupId;
    setListeningGroup(groupId);
    try {
      await client.connect(getLiveKitUrl(), join.token);
      setMicPermitted(client.canPublishMic);
    } catch (err) {
      await disconnectAudio();
      await roundTableApi.leave(sessionId, groupId).catch(() => undefined);
      throw err;
    }
  }

  async function leave(groupId: string): Promise<void> {
    await disconnectAudio();
    await roundTableApi.leave(sessionId, groupId);
  }

  async function participate(groupId: string): Promise<void> {
    if (listeningRef.current !== groupId) await startListening(groupId);
    await roundTableApi.participate(sessionId, groupId);
  }

  if (overview.isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (overview.isError || !overview.data) {
    return <p className="p-6 text-sm text-destructive">Could not load this session: {(overview.error as Error | null)?.message ?? 'unknown error'}</p>;
  }
  const data = overview.data;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Round Table · {data.title}</h1>
          <p className="text-sm text-muted-foreground">
            Listen in on any group and join the discussion when needed. Students always see when you are present.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.state === 'RUNNING' ? 'success' : 'secondary'}>{data.state}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link to="/sessions">Back to sessions</Link>
          </Button>
        </div>
      </div>

      {audioBlocked && (
        <button type="button" onClick={() => void clientRef.current?.startAudio()} className="w-full rounded-md bg-amber-900 px-3 py-2 text-sm text-amber-100">
          Your browser blocked audio playback — click here to hear the group.
        </button>
      )}

      {groups.length === 0 && <p className="text-sm text-muted-foreground">This session has no Round Table groups.</p>}
      {data.state === 'ENDED' ? (
        // After the session, review replaces the live monitor entirely — there
        // is nothing left to listen in on or grant the floor for.
        <div className="space-y-4">
          {groups.map((g) => (
            <RoundTableReview key={g.groupId} sessionId={sessionId} groupId={g.groupId} />
          ))}
        </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <RoundTableGroupCard
            key={g.groupId}
            group={g}
            floor={floorOf(g.groupId)}
            sessionState={data.state}
            listening={listeningGroup === g.groupId}
            speakers={listeningGroup === g.groupId ? speakers : new Set()}
            micPermitted={micPermitted}
            busy={busyGroup === g.groupId}
            alert={alerts[g.groupId] ?? null}
            error={errors[g.groupId] || null}
            onListen={() => void act(g.groupId, () => startListening(g.groupId))}
            onStopListening={() => void act(g.groupId, () => leave(g.groupId))}
            onParticipate={() => void act(g.groupId, () => participate(g.groupId))}
            onLeave={() => void act(g.groupId, () => leave(g.groupId))}
            onGrant={(stationId) => void act(g.groupId, () => roundTableApi.grant(sessionId, g.groupId, stationId))}
            onRevoke={() => void act(g.groupId, () => roundTableApi.revoke(sessionId, g.groupId))}
            onChairman={(stationId) =>
              void act(g.groupId, async () => {
                await roundTableApi.setChairman(sessionId, g.groupId, stationId);
                setAlerts((prev) => {
                  const { [g.groupId]: _cleared, ...rest } = prev;
                  return rest;
                });
              })
            }
            onMuteAll={() => void act(g.groupId, () => roundTableApi.muteAll(sessionId, g.groupId))}
          />
        ))}
      </div>
      )}
      <div ref={audioRef} className="hidden" />
    </div>
  );
}
