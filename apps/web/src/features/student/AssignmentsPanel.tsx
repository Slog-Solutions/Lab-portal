import { useEffect, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { useStudentSession } from '../../stores/student-session-store';
import { VocabularyTestPlayer } from '../activities/VocabularyTestPlayer';
import { ContentExercisePlayer } from '../activities/ContentExercisePlayer';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type AssignmentRow = Awaited<ReturnType<typeof stationApi.myAssignments>>[number];

/**
 * Self-paced assessment (Ser 10 "teacher-tailored courses" — targetScore/
 * allocatedHours/dueAt) — deliberately independent of live session state,
 * matching Ser 1's "self-study even when teacher not present". Only
 * renders once a student has signed in at this seat (StudentConsole gates
 * on useStudentSession — see StudentSignInScreen), so this component no
 * longer owns any credential UI itself; it fetches assignments as soon as
 * it mounts, using the student's own JWT-backed studentToken.
 */
export function AssignmentsPanel({ control }: { control: StationControlClient }) {
  const student = useStudentSession((s) => s.student);
  const clearSession = useStudentSession((s) => s.clear);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [started, setStarted] = useState<StartedAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  // /attempts/* is still StationAuthGuard-only (see attempts.controller.ts's
  // doc comment) — it resolves "which student" from Station.currentUserId,
  // set at claim time, not from a JWT `sub`. So these calls use the
  // station's own token (control.getToken()), never the student's JWT.
  // This panel only ever mounts once a student is signed in, so a plain
  // mount-effect fetch is enough — no polling needed (that workaround
  // existed only for the old claim recovery flow).
  useEffect(() => {
    stationApi
      .myAssignments(control.getToken())
      .then(setAssignments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load assignments'));
  }, [control]);

  async function release(): Promise<void> {
    await stationApi.release(control.getToken());
    clearSession();
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

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">My Assignments — {student?.fullName}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void release()}>
          Sign out
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {assignments === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {assignments?.length === 0 && <p className="text-sm text-muted-foreground">No assignments yet.</p>}
        {assignments?.map((row) => {
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
