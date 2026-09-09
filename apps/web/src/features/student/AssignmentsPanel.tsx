import { useEffect, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { VocabularyTestPlayer } from '../activities/VocabularyTestPlayer';
import { ContentExercisePlayer } from '../activities/ContentExercisePlayer';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type AssignmentRow = Awaited<ReturnType<typeof stationApi.myAssignments>>[number];

/**
 * Self-paced assessment (Ser 10 "teacher-tailored courses" — targetScore/
 * allocatedHours/dueAt) — deliberately independent of live session state,
 * matching Ser 1's "self-study even when teacher not present". A station
 * claims itself as a specific enrolled student first (roster pick, not a
 * login — see StationsService.claim's doc comment), then sees its own
 * assignments and can start/resume/review each.
 */
export function AssignmentsPanel({ control }: { control: StationControlClient }) {
  const [claimed, setClaimed] = useState<string | null>(null);
  const [serviceNumber, setServiceNumber] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [started, setStarted] = useState<StartedAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A page refresh loses local `claimed` state, but the server still
    // remembers this station's claimed student — try to recover it
    // silently once the station has its own token (minted on hello).
    const timer = setInterval(() => {
      if (!control.getToken()) return;
      clearInterval(timer);
      stationApi
        .myAssignments(control.getToken())
        .then((list) => {
          setAssignments(list);
          setClaimed((prev) => prev ?? 'Student session active');
        })
        .catch(() => void 0); // not claimed yet — expected on first boot
    }, 500);
    return () => clearInterval(timer);
  }, [control]);

  async function claim(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await stationApi.claim(control.getToken(), serviceNumber.trim());
      setClaimed(res.fullName);
      setAssignments(await stationApi.myAssignments(control.getToken()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  async function release(): Promise<void> {
    await stationApi.release(control.getToken());
    setClaimed(null);
    setAssignments([]);
    setServiceNumber('');
  }

  async function startAssignment(row: AssignmentRow): Promise<void> {
    setError(null);
    try {
      const res = await stationApi.startAttempt(control.getToken(), {
        exerciseId: row.exercise.id,
        assignmentId: row.assignment.id,
      });
      setStarted(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start attempt');
    }
  }

  async function onDone(): Promise<void> {
    setStarted(null);
    setAssignments(await stationApi.myAssignments(control.getToken()));
  }

  if (started) {
    switch (started.exercise.type) {
      case 'VOCABULARY_TEST':
        return <VocabularyTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'CONTENT_EXERCISE':
        return <ContentExercisePlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'PRONUNCIATION':
        return <PronunciationPlayer control={control} started={started} onDone={() => void onDone()} />;
      default:
        return <p className="text-sm text-muted-foreground">{started.exercise.type} has no self-paced player.</p>;
    }
  }

  if (!claimed) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-base">My Assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Enter your service number to see your assignments.</p>
          <Input
            value={serviceNumber}
            onChange={(e) => setServiceNumber(e.target.value)}
            placeholder="e.g. STU-014"
            onKeyDown={(e) => e.key === 'Enter' && void claim()}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void claim()} disabled={busy || !serviceNumber.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">My Assignments — {claimed}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void release()}>
          Sign out
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {assignments.length === 0 && <p className="text-sm text-muted-foreground">No assignments yet.</p>}
        {assignments.map((row) => {
          const latest = row.latestAttempt;
          const pct = latest?.rawScore !== undefined && latest?.rawScore !== null && latest?.maxScore
            ? Math.round((latest.rawScore / latest.maxScore) * 100)
            : null;
          return (
            <div key={row.assignment.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div>
                <p className="text-sm font-medium">{row.exercise.title}</p>
                <p className="text-xs text-muted-foreground">{row.exercise.type}</p>
              </div>
              <div className="flex items-center gap-2">
                {latest && <Badge variant={latest.status === 'SCORED' ? 'success' : 'secondary'}>{pct !== null ? `${pct}%` : latest.status}</Badge>}
                <Button size="sm" onClick={() => void startAssignment(row)}>
                  {latest ? 'Retry' : 'Start'}
                </Button>
              </div>
            </div>
          );
        })}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
