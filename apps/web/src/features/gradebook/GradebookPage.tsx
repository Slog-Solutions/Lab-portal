import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gradebookApi, type AttemptRow } from '../../lib/gradebook-api';
import { exercisesApi } from '../../lib/exercises-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/** Ser 4 "Report tool... allow teachers to view, edit and save [scores]"
 * — every edit here is an audited ScoreOverride (gradebook-api.ts's
 * override(), never a silent field update). */
export function GradebookPage() {
  const queryClient = useQueryClient();
  const [exerciseId, setExerciseId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const { data: exercises } = useQuery({ queryKey: queryKeys.exercises, queryFn: exercisesApi.list });
  const filter = { exerciseId: exerciseId || undefined, status: status || undefined };
  const { data: attempts, isLoading } = useQuery({
    queryKey: queryKeys.gradebookAttempts(filter),
    queryFn: () => gradebookApi.listAttempts(filter),
  });

  const [overrideTarget, setOverrideTarget] = useState<AttemptRow | null>(null);
  const [newScore, setNewScore] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const override = useMutation({
    mutationFn: () => gradebookApi.override(overrideTarget!.id, Number(newScore), reason),
    onSuccess: () => {
      setOverrideTarget(null);
      setNewScore('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['gradebook'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Override failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Gradebook</h1>
        <p className="text-sm text-muted-foreground">Every attempt across all exercises — edit a score and it's recorded as an audited override.</p>
      </div>

      <div className="flex gap-3">
        <Select value={exerciseId || 'all'} onValueChange={(v) => setExerciseId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All exercises" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exercises</SelectItem>
            {exercises?.map((ex) => (
              <SelectItem key={ex.id} value={ex.id}>
                {ex.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="IN_PROGRESS">In progress</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="SCORED">Scored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Exercise</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts?.map((a) => {
                  const pct = a.rawScore !== null && a.maxScore ? Math.round((a.rawScore / a.maxScore) * 100) : null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        {a.student.fullName} <span className="text-xs text-muted-foreground">({a.student.serviceNumber})</span>
                      </TableCell>
                      <TableCell>{a.exercise.title}</TableCell>
                      <TableCell>
                        {pct !== null ? `${pct}%` : '—'}
                        {a.scoreOverride && <Badge variant="warning" className="ml-2">overridden</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'SCORED' ? 'success' : 'secondary'}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setOverrideTarget(a);
                            setNewScore(String(pct ?? ''));
                          }}
                        >
                          Edit score
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Score — {overrideTarget?.student.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New score (%)</Label>
              <Input type="number" min={0} max={100} value={newScore} onChange={(e) => setNewScore(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Reason (required — audit trail)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => override.mutate()} disabled={override.isPending || !reason.trim() || newScore === ''}>
              {override.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
