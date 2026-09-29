import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { seatLabel } from '@lab/shared';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { timedTestsApi } from '../../../lib/timed-tests-api';
import { useTestClock } from '../../activities/vocab/use-test-clock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const boardKey = (id: string) => ['activity-instances', id, 'board'] as const;

const ROW_LABEL: Record<string, { label: string; variant: 'outline' | 'secondary' | 'success' }> = {
  NOT_STARTED: { label: 'Not started', variant: 'outline' },
  ANSWERING: { label: 'Answering', variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', variant: 'success' },
};

/**
 * SPEC-mcq-test-timed-reveal.md §7.3 "Live board" — per-station progress,
 * countdown, and the teacher's overrides (Reveal now / Extend / Close
 * without reveal / Release). Polls every 2s (RoundTableMonitorPage's
 * socket-driven model is overkill at the scale a single lab runs — see
 * the parent plan's own note on this) rather than a dedicated socket feed.
 */
export function LiveTestBoardPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const queryClient = useQueryClient();

  const { data: board, isLoading, error } = useQuery({
    queryKey: boardKey(instanceId!),
    queryFn: () => timedTestsApi.board(instanceId!),
    enabled: Boolean(instanceId),
    refetchInterval: 2_000,
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: boardKey(instanceId!) });
  }
  const revealNow = useMutation({ mutationFn: () => timedTestsApi.revealNow(instanceId!), onSuccess: invalidate });
  const extend = useMutation({ mutationFn: (seconds: number) => timedTestsApi.extend(instanceId!, seconds), onSuccess: invalidate });
  const closeTest = useMutation({ mutationFn: () => timedTestsApi.close(instanceId!), onSuccess: invalidate });
  const release = useMutation({ mutationFn: () => timedTestsApi.release(instanceId!), onSuccess: invalidate });
  const busy = revealNow.isPending || extend.isPending || closeTest.isPending || release.isPending;
  const mutationError = revealNow.error ?? extend.error ?? closeTest.error ?? release.error;

  const clock = useTestClock({ closesAt: board?.closesAt ?? null, serverNow: board?.serverNow ?? Date.now(), startedAt: null });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error || !board) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load this test'}</p>;
  }

  const answeredTotal = board.rows.filter((r) => r.status !== 'NOT_STARTED').length;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/assignments/vocabulary" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Vocabulary tests
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{board.title}</h1>
            <p className="text-sm text-muted-foreground">
              {answeredTotal} of {board.rows.length} started · {board.status === 'READY' ? 'Not started yet' : board.status === 'CLOSED' ? 'Closed' : 'Running'}
              {board.revealed && ' · Revealed'}
            </p>
          </div>
          {board.closesAt !== null && board.status !== 'CLOSED' && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Reveals in</p>
              <p className={`text-3xl font-semibold tabular-nums ${clock.warn ? 'text-destructive' : ''}`}>{clock.label}</p>
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => revealNow.mutate()} disabled={busy || (board.status === 'CLOSED' && board.revealed)}>
            Reveal now
          </Button>
          <Button variant="outline" onClick={() => extend.mutate(60)} disabled={busy || board.status === 'CLOSED' || board.closesAt === null}>
            Extend +1 min
          </Button>
          <Button variant="outline" onClick={() => extend.mutate(300)} disabled={busy || board.status === 'CLOSED' || board.closesAt === null}>
            Extend +5 min
          </Button>
          <Button variant="outline" onClick={() => closeTest.mutate()} disabled={busy || board.status === 'CLOSED'}>
            Close without reveal
          </Button>
          {board.status === 'CLOSED' && !board.revealed && (
            <Button onClick={() => release.mutate()} disabled={busy}>
              Release results
            </Button>
          )}
          {mutationError && <p className="w-full text-sm text-destructive">{mutationError instanceof Error ? mutationError.message : 'That action failed'}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seat</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.rows.map((row) => {
                const status = ROW_LABEL[row.status] ?? ROW_LABEL.NOT_STARTED!;
                const pct = row.rawScore !== null && row.maxScore ? Math.round((row.rawScore / row.maxScore) * 100) : null;
                return (
                  <TableRow key={row.stationId}>
                    <TableCell>{row.seatNo !== null ? seatLabel(row.seatNo) : '—'}</TableCell>
                    <TableCell>{row.studentName ?? <span className="text-muted-foreground">Empty seat</span>}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.total > 0 ? `${row.answered} / ${row.total}` : '—'}
                    </TableCell>
                    <TableCell>{pct !== null ? `${pct}%` : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
