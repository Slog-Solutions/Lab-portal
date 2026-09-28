import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { seatLabel } from '@lab/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { gradebookApi } from '../../../lib/gradebook-api';
import { queryKeys } from '../../../lib/query-keys';
import { roundTableApi, type RoundTableReviewTurn } from '../../../lib/round-table-api';
import { mmss } from '../../../lib/use-now';

const seatOf = (m: { stationId: string; seatNo: number | null; studentName: string | null } | undefined, id: string) =>
  m ? `Seat ${seatLabel(m.seatNo)}${m.studentName ? ` · ${m.studentName}` : ''}` : id.slice(0, 8);

interface LoadedTrack {
  stationId: string;
  buffer: AudioBuffer;
  /** ms from the group's activity start where this recording begins. */
  offsetMs: number;
}

/**
 * Per-group review (Ser 3, spec 7.3): the turn timeline underneath a
 * synchronized playback of every member's own recording (client-side
 * recording is by design — see §2.6 — so there is no single mixed file;
 * this is what "one recording" means here: several tracks played in sync).
 * "What the group heard" mutes every track except whoever's turn covers the
 * current position, matching the floor rules; "All mics" plays everything.
 */
export function RoundTableReview({ sessionId, groupId }: { sessionId: string; groupId: string }) {
  const query = useQuery({ queryKey: queryKeys.roundTableReview(sessionId, groupId), queryFn: () => roundTableApi.review(sessionId, groupId) });
  const [mode, setMode] = useState<'group' | 'all'>('group');
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const tracksRef = useRef<LoadedTrack[]>([]);
  const gainsRef = useRef<Map<string, GainNode>>(new Map());
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const clockRef = useRef<{ ctxStart: number; positionMs: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const data = query.data;
  const durationMs = useMemo(() => {
    if (!data) return 0;
    const fromTurns = data.turns.reduce((m, t) => Math.max(m, t.endMs), 0);
    const fromRecordings = data.recordings.reduce((m, r) => Math.max(m, (r.offsetMs ?? 0) + (r.durationMs ?? 0)), 0);
    return Math.max(fromTurns, fromRecordings, 1000);
  }, [data]);

  // Load every seat's recording once and decode it into an AudioBuffer, kept
  // in a fixed AudioContext for the life of the page — decoding again on
  // every play/seek would be needless work and a resync risk.
  const load = useCallback(async () => {
    if (!data || data.recordings.length === 0) return;
    setLoadState('loading');
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      const loaded: LoadedTrack[] = [];
      for (const rec of data.recordings) {
        if (rec.status !== 'ready' || !rec.stationId) continue;
        const blobUrl = await gradebookApi.fetchRecordingBlob(rec.id);
        const arrayBuffer = await (await fetch(blobUrl)).arrayBuffer();
        URL.revokeObjectURL(blobUrl);
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        loaded.push({ stationId: rec.stationId, buffer, offsetMs: rec.offsetMs ?? 0 });
      }
      tracksRef.current = loaded;
      for (const track of loaded) {
        if (gainsRef.current.has(track.stationId)) continue;
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gainsRef.current.set(track.stationId, gain);
      }
      setLoadState('ready');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[round-table-review] failed to load recordings', err);
      setLoadState('error');
    }
  }, [data]);

  useEffect(() => {
    return () => {
      stop();
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  function stop(): void {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    setPlaying(false);
  }

  /** Whoever's turn (any role) covers `atMs` — that is who was audible at
   * that moment under the floor rules (chairman continuous, one speaker). */
  function audibleAt(atMs: number): Set<string> {
    const ids = new Set<string>();
    for (const t of data?.turns ?? []) {
      if (t.stationId && t.startMs <= atMs && atMs < t.endMs) ids.add(t.stationId);
    }
    return ids;
  }

  function tick(): void {
    const ctx = audioCtxRef.current;
    const clock = clockRef.current;
    if (!ctx || !clock) return;
    const nowMs = clock.positionMs + (ctx.currentTime - clock.ctxStart) * 1000;
    if (nowMs >= durationMs) {
      stop();
      setPositionMs(durationMs);
      return;
    }
    setPositionMs(nowMs);
    const audible = modeRef.current === 'all' ? null : audibleAt(nowMs);
    for (const [stationId, gain] of gainsRef.current) {
      const want = audible === null || audible.has(stationId) ? 1 : 0;
      gain.gain.setTargetAtTime(want, ctx.currentTime, 0.05);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function play(fromMs: number = positionMs): void {
    stop();
    const ctx = audioCtxRef.current;
    if (!ctx || tracksRef.current.length === 0) return;
    void ctx.resume();
    const startAt = ctx.currentTime + 0.05;
    for (const track of tracksRef.current) {
      const trackEndMs = track.offsetMs + track.buffer.duration * 1000;
      if (fromMs >= trackEndMs) continue;
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      const gain = gainsRef.current.get(track.stationId);
      if (gain) source.connect(gain);
      const delaySec = Math.max(0, (track.offsetMs - fromMs) / 1000);
      const bufferOffsetSec = Math.max(0, (fromMs - track.offsetMs) / 1000);
      source.start(startAt + delaySec, bufferOffsetSec);
      sourcesRef.current.push(source);
    }
    clockRef.current = { ctxStart: startAt, positionMs: fromMs };
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }

  function seekTo(ms: number): void {
    const clamped = Math.min(durationMs, Math.max(0, ms));
    setPositionMs(clamped);
    if (playing) play(clamped);
  }

  if (query.isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading review…</p>;
  if (query.isError || !data) {
    return <p className="p-4 text-sm text-destructive">Could not load this group's review: {(query.error as Error | null)?.message ?? 'unknown error'}</p>;
  }

  const byId = new Map(data.members.map((m) => [m.stationId, m]));
  const laneOf = (id: string): RoundTableReviewTurn[] => data.turns.filter((t) => t.stationId === id);
  const pct = (ms: number) => `${Math.min(100, (ms / durationMs) * 100)}%`;
  const hasAudio = data.recordings.some((r) => r.status === 'ready' && r.stationId);

  return (
    <Card data-testid="rt-review">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Round Table review · {data.topic}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-input text-xs">
              <button type="button" onClick={() => setMode('group')} className={`px-2 py-1 ${mode === 'group' ? 'bg-primary text-primary-foreground' : ''}`}>
                What the group heard
              </button>
              <button type="button" onClick={() => setMode('all')} className={`px-2 py-1 ${mode === 'all' ? 'bg-primary text-primary-foreground' : ''}`}>
                All mics
              </button>
            </div>
            {data.recordings.length === 0 ? (
              <Badge variant="secondary">No recordings</Badge>
            ) : loadState === 'ready' ? (
              <Button size="sm" onClick={() => (playing ? stop() : play())} disabled={!hasAudio}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? 'Pause' : 'Play'}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void load()} disabled={loadState === 'loading'}>
                {loadState === 'loading' ? 'Loading…' : loadState === 'error' ? 'Retry loading audio' : 'Load audio'}
              </Button>
            )}
            <span data-testid="rt-review-position" className="w-24 text-right text-xs text-muted-foreground">
              {mmss(positionMs)} / {mmss(durationMs)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div data-testid="rt-timeline" className="space-y-1">
          {data.members.map((m) => (
            <div key={m.stationId} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">{seatOf(m, m.stationId)}</span>
              <div
                className="relative h-6 flex-1 cursor-pointer rounded bg-muted/40"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seekTo(((e.clientX - rect.left) / rect.width) * durationMs);
                }}
              >
                {laneOf(m.stationId).map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    title={`${mmss(t.startMs)} – ${mmss(t.endMs)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(t.startMs);
                    }}
                    className={`absolute inset-y-0 rounded ${t.role === 'CHAIRMAN' ? 'bg-amber-600' : 'bg-emerald-600'} hover:brightness-110`}
                    style={{ left: pct(t.startMs), width: `max(2px, calc(${pct(t.endMs)} - ${pct(t.startMs)}))` }}
                  />
                ))}
                <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: pct(positionMs) }} />
              </div>
            </div>
          ))}
          {data.teacherMs > 0 && <p className="text-xs text-muted-foreground">Teacher spoke for {mmss(data.teacherMs)} total.</p>}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seat</TableHead>
              <TableHead>Turns</TableHead>
              <TableHead>Total speaking time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.totals.map((t) => (
              <TableRow key={t.stationId} data-testid="rt-total-row">
                <TableCell>{seatOf(byId.get(t.stationId), t.stationId)}</TableCell>
                <TableCell>{t.turns}</TableCell>
                <TableCell>
                  {mmss(t.speakingMs)}
                  {t.neverSpoke && (
                    <Badge variant="warning" className="ml-2">
                      Never took the floor
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
