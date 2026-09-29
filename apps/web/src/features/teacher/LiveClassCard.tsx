import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { classroomApi } from '../../lib/classroom-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';

/**
 * "Start Live Class" (ClassDetailPage) — the batch-scoped counterpart to
 * Lab Control's ad-hoc ClassroomPanel (StatusBoardPage). Starting it here
 * removes the classroom code entirely for this roster: every enrolled
 * student already signed in is attached in the same call
 * (ClassroomService.start's batchId branch), and any enrolled student who
 * signs in later — while it stays ACTIVE — auto-joins too
 * (StationsService.claim's no-code branch). The code still exists and
 * still works (e.g. a walk-in from another class), it just stops being a
 * required step for this one.
 *
 * A teacher can only run one live class at a time (the existing Lab
 * Control invariant): if one is already active for something else,
 * starting this one just extends its scope to include this roster too —
 * whoever already joined stays joined.
 */
export function LiveClassCard({ classId, batchName }: { classId: string; batchName: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: currentClass, isLoading } = useQuery({ queryKey: ['classroom', 'current'], queryFn: classroomApi.current });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['classroom', 'current'] });
  }

  const start = useMutation({
    mutationFn: () => classroomApi.start({ batchId: classId }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to start the live class'),
  });

  const end = useMutation({
    mutationFn: (id: string) => classroomApi.end(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to end the live class'),
  });

  const isActive = currentClass?.state === 'ACTIVE';
  const isThisClass = isActive && currentClass!.batchId === classId;
  const isOtherClass = isActive && currentClass!.batchId !== classId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live Class</CardTitle>
        <CardDescription>
          Start this class live so every enrolled student who is signed in — now or later — joins automatically, with no code to type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isThisClass ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Live class code</p>
                <p className="font-mono text-lg font-semibold text-primary">{currentClass!.code}</p>
              </div>
              <CopyButton value={currentClass!.code} label="live class code" />
            </div>
            <Badge variant="success">{currentClass!.memberCount} joined</Badge>
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto"
              disabled={end.isPending}
              onClick={() => {
                const count = currentClass!.memberCount;
                if (window.confirm(`This signs out all ${count} student${count === 1 ? '' : 's'}. End the live class?`)) {
                  end.mutate(currentClass!.id);
                }
              }}
            >
              {end.isPending ? 'Ending…' : 'End live class'}
            </Button>
          </div>
        ) : (
          <>
            {isOtherClass && (
              <p className="text-xs text-status-pending">
                You have a different live session running (&quot;{currentClass!.title}&quot;). Starting this one extends it to also
                auto-join {batchName} — students already in it stay connected.
              </p>
            )}
            <Button size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Starting…' : 'Start Live Class'}
            </Button>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
