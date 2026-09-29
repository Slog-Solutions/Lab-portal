import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Play, Trash2 } from 'lucide-react';
import type { ClassRecordingView } from '@lab/shared';
import { classRecordingsApi } from '../../lib/class-recordings-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: ClassRecordingView['status'] }) {
  if (status === 'ready') return <Badge variant="success">Ready</Badge>;
  if (status === 'recording') return <Badge variant="warning">Recording…</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed — nothing captured</Badge>;
  return <Badge variant="outline">Incomplete</Badge>;
}

/** Play/Download need a real file — a still-recording or failed (zero
 * chunks ever landed) row has none. */
function hasPlayableFile(status: ClassRecordingView['status']): boolean {
  return status === 'ready' || status === 'incomplete';
}

/**
 * Recordings a teacher (or, for an admin, any teacher) made of their own
 * class broadcast with BroadcastPanel's Record button. Distinct from the
 * per-activity Recording rows students produce during an exercise (see
 * ClassActivityEntry.recordings) — this page is the teacher-facing list,
 * matching how MediaFilesTab lists the media library.
 */
export function ClassRecordingsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  // Polled, not just fetched once — a recording made minutes ago should
  // flip from "Recording…" to "Ready" here without a manual refresh, the
  // same reasoning as the student study pane's own 15s poll.
  const { data: recordings, isLoading } = useQuery({
    queryKey: queryKeys.classRecordings,
    queryFn: classRecordingsApi.list,
    refetchInterval: 15_000,
  });
  const [playing, setPlaying] = useState<ClassRecordingView | null>(null);

  const remove = useMutation({
    mutationFn: classRecordingsApi.remove,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.classRecordings }),
  });

  async function download(recording: ClassRecordingView): Promise<void> {
    const url = await classRecordingsApi.fetchBlobUrl(recording.id);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date(recording.createdAt).toISOString().slice(0, 10);
    const name = (recording.classTitle ?? 'class').replace(/[^\w-]+/g, '-');
    a.download = `${name}-${date}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recordings</h1>
        <p className="text-sm text-muted-foreground">Recordings of your class broadcasts, made with the Record button on Lab Control.</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !recordings?.length ? (
            <p className="text-sm text-muted-foreground">No recordings yet — start a broadcast and click Record on Lab Control.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  {user?.role === 'ADMIN' && <TableHead>Teacher</TableHead>}
                  <TableHead>Recorded</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Audio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recordings.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.classTitle ?? 'Lab-wide broadcast'}</TableCell>
                    {user?.role === 'ADMIN' && <TableCell className="text-xs text-muted-foreground">{r.teacherName}</TableCell>}
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDuration(r.durationMs)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatSize(r.sizeBytes)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.withAudio ? 'With audio' : 'No audio'}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={!hasPlayableFile(r.status)} onClick={() => setPlaying(r)}>
                        <Play /> Play
                      </Button>
                      <Button size="sm" variant="outline" disabled={!hasPlayableFile(r.status)} onClick={() => void download(r)}>
                        <Download /> Download
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete recording"
                        onClick={() => {
                          if (window.confirm('Delete this recording? This cannot be undone.')) remove.mutate(r.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RecordingPlayerDialog recording={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

function RecordingPlayerDialog({ recording, onClose }: { recording: ClassRecordingView | null; onClose: () => void }) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});

  // <video src> can't carry an Authorization header, so the file is
  // fetched as a blob and shown from an object URL — same pattern as
  // AssetPreviewDialog (media library).
  useEffect(() => {
    if (!recording) return;
    let cancelled = false;
    let created: string | null = null;
    setState({});
    classRecordingsApi
      .fetchBlobUrl(recording.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setState({ url });
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [recording]);

  return (
    <Dialog open={recording !== null} onOpenChange={(open) => !open && onClose()}>
      {recording && (
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{recording.classTitle ?? 'Lab-wide broadcast'}</DialogTitle>
          </DialogHeader>
          {state.url ? (
            <video
              controls
              autoPlay
              src={state.url}
              className="w-full rounded-md bg-black"
              style={{ maxHeight: '60vh' }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                // A MediaRecorder-produced WebM carries no duration in its
                // header, so the seek bar reports Infinity until the
                // browser is forced to compute it: seek near the end once,
                // then back to the start.
                if (el.duration === Infinity || Number.isNaN(el.duration)) {
                  el.currentTime = 1e101;
                  const onTimeUpdate = () => {
                    el.currentTime = 0;
                    el.removeEventListener('timeupdate', onTimeUpdate);
                  };
                  el.addEventListener('timeupdate', onTimeUpdate);
                }
              }}
            />
          ) : state.failed ? (
            <p className="text-sm text-status-pending">Could not load this recording.</p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
