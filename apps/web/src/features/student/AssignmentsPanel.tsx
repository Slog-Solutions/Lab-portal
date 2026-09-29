import { useEffect, useState } from 'react';
import { NO_WRITTEN_FEEDBACK, type AttemptResultView } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { ApiError } from '../../lib/api-client';
import { useDictionaryStore } from '../../stores/dictionary-store';
import { VocabularyTestPlayer } from '../activities/VocabularyTestPlayer';
import { TestResultView } from '../activities/vocab/TestResultView';
import { ContentExercisePlayer } from '../activities/ContentExercisePlayer';
import { PronunciationPlayer } from '../activities/PronunciationPlayer';
import { PronunciationTestPlayer } from '../activities/PronunciationTestPlayer';
import { WritingTestPlayer } from '../activities/WritingTestPlayer';
import { ListeningTestPlayer } from '../activities/ListeningTestPlayer';
import { ReadingTestPlayer } from '../activities/ReadingTestPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type AssignmentRow = Awaited<ReturnType<typeof stationApi.myAssignments>>[number];

const POLL_MS = 30_000;

const TYPE_LABEL: Record<string, string> = {
  VOCABULARY_TEST: 'Vocabulary test',
  WRITING_TEST: 'Writing test',
  LISTENING_TEST: 'Listening test',
  READING_TEST: 'Reading test',
  PRONUNCIATION: 'Pronunciation exercise',
  PRONUNCIATION_TEST: 'Pronunciation test',
};

/**
 * Self-paced assessment (Ser 10 "teacher-tailored courses" — targetScore/
 * allocatedHours/dueAt) — deliberately independent of live session state,
 * matching Ser 1's "self-study even when teacher not present". Only
 * renders once a student has signed in at this seat (StudentConsole gates
 * on useStudentSession — see StudentSignInScreen), so this component owns
 * no credential or sign-out UI itself (sign-out lives in the student
 * drawer); it fetches assignments as soon as
 * it mounts, using the student's own JWT-backed studentToken.
 *
 * A teacher can send a pronunciation test (Ser 7) to a seat that is
 * already signed in and mid-class, so the list is also refreshed every
 * POLL_MS while it is showing (paused while an exercise is open — a
 * refetch there would only churn state under an in-progress recording)
 * and on demand via the Refresh button.
 *
 * SPEC-mcq-test-timed-reveal.md: `row.oneShot`/`row.resultsPending` are
 * server-computed (see AttemptsService.listAssignmentsForStudent) rather
 * than reproduced here — a real timed/teacher-released vocabulary test is
 * one-shot the same way a writing test always was, and its `latestAttempt`
 * is masked to SUBMITTED (no score) until AttemptsService.getResult says
 * it's revealed, same server-side gate the live "Launch in lab" path uses.
 */
export function AssignmentsPanel({ control }: { control: StationControlClient }) {
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [started, setStarted] = useState<StartedAttempt | null>(null);
  const [viewingResult, setViewingResult] = useState<{ title: string; result: AttemptResultView } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // /attempts/* is still StationAuthGuard-only (see attempts.controller.ts's
  // doc comment) — it resolves "which student" from Station.currentUserId,
  // set at claim time, not from a JWT `sub`. So these calls use the
  // station's own token (control.getToken()), never the student's JWT.
  // This panel only ever mounts once a student is signed in, so the
  // initial fetch needs no claim-recovery workaround — the interval below
  // exists only to pick up assignments a teacher sends mid-class.
  useEffect(() => {
    stationApi
      .myAssignments(control.getToken())
      .then(setAssignments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load assignments'));
  }, [control]);

  useEffect(() => {
    if (started || viewingResult) return;
    const timer = setInterval(() => {
      // Background refresh failures stay silent — the manual Refresh button
      // reports them, and a flaky moment shouldn't flash an error at a
      // student who is just reading the list.
      stationApi
        .myAssignments(control.getToken())
        .then(setAssignments)
        .catch(() => void 0);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [control, started, viewingResult]);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      setAssignments(await stationApi.myAssignments(control.getToken()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments');
    }
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
      // A one-shot vocabulary test already submitted (e.g. the list was
      // stale, or a second tab) — open its result directly rather than
      // showing a raw error for what the student experiences as normal.
      const attemptId = err instanceof ApiError && typeof err.details?.attemptId === 'string' ? err.details.attemptId : null;
      if (err instanceof ApiError && err.code === 'ALREADY_SUBMITTED' && attemptId) {
        await viewResult(attemptId, row.exercise.title);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to start attempt');
    }
  }

  async function viewResult(attemptId: string, title: string): Promise<void> {
    setError(null);
    try {
      setViewingResult({ title, result: await stationApi.attemptResult(control.getToken(), attemptId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load result');
    }
  }

  async function onDone(): Promise<void> {
    setStarted(null);
    setAssignments(await stationApi.myAssignments(control.getToken()));
  }

  // Offline dictionary (SPEC-offline-dictionary.md §7, Phase 0 decision
  // 2026-09-28): a self-paced Assignment test is a second, independent
  // block source alongside the live-session activity toggle DictionaryPanel
  // already reads from the station snapshot — looking up the answer during
  // a vocabulary test defeats the test whether it's delivered live or as
  // an assignment. The server enforces this independently either way
  // (DictionaryPolicyService); this only drives the client-side hide.
  useEffect(() => {
    useDictionaryStore.getState().setDisabledReason(started && !started.exercise.dictionaryEnabled ? 'test' : null);
    return () => useDictionaryStore.getState().setDisabledReason(null);
  }, [started]);

  if (viewingResult) {
    if (viewingResult.result.status === 'OPEN') return null; // shouldn't happen — reached only for a finished attempt
    return <TestResultView result={viewingResult.result} title={viewingResult.title} onDismiss={() => setViewingResult(null)} />;
  }

  if (started) {
    switch (started.exercise.type) {
      case 'VOCABULARY_TEST':
        return <VocabularyTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'CONTENT_EXERCISE':
        return <ContentExercisePlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'PRONUNCIATION':
        return <PronunciationPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'PRONUNCIATION_TEST':
        return <PronunciationTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'WRITING_TEST':
        return <WritingTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'LISTENING_TEST':
        return <ListeningTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      case 'READING_TEST':
        return <ReadingTestPlayer control={control} started={started} onDone={() => void onDone()} />;
      default:
        return <p className="text-sm text-muted-foreground">{started.exercise.type} has no self-paced player.</p>;
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">My Assignments</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          Refresh
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
          // A test is a one-shot assessment (the server rejects a second
          // start — AttemptsService.assertTestStartable/startSelfPaced), so
          // once submitted the row shows its state instead of a Start/Retry
          // button. A vocabulary test can be one-shot too now (a real
          // timed/teacher-released test) — row.oneShot already reflects that.
          const finished = latest?.status === 'SUBMITTED' || latest?.status === 'SCORED';
          const locked = row.oneShot && finished;
          const isVocabWithResult = row.exercise.type === 'VOCABULARY_TEST' && finished;
          const badgeText = row.resultsPending
            ? 'Waiting for results'
            : locked && latest?.status === 'SUBMITTED'
              ? 'Awaiting review'
              : pct !== null
                ? `${pct}%`
                : latest?.status;
          return (
            <div key={row.assignment.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.exercise.title}</p>
                {/* A student can be in several classes now, so every row says
                    where it came from — the class name when the server could
                    pin it down, otherwise just the assigning teacher. */}
                <p className="text-xs text-muted-foreground">
                  {TYPE_LABEL[row.exercise.type] ?? row.exercise.type} · {row.source.className ?? `From ${row.source.teacherName}`}
                  {row.assignment.dueAt && ` · Due ${new Date(row.assignment.dueAt).toLocaleDateString()}`}
                </p>
                {locked && latest?.scoreOverride?.reason && latest.scoreOverride.reason !== NO_WRITTEN_FEEDBACK && (
                  <p className="mt-1 text-xs text-muted-foreground">Teacher: {latest.scoreOverride.reason}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {latest && <Badge variant={row.resultsPending ? 'secondary' : latest.status === 'SCORED' ? 'success' : 'secondary'}>{badgeText}</Badge>}
                {isVocabWithResult && (
                  <Button size="sm" variant="outline" onClick={() => void viewResult(latest!.id, row.exercise.title)}>
                    View result
                  </Button>
                )}
                {!locked && (
                  <Button size="sm" onClick={() => void startAssignment(row)}>
                    {latest?.status === 'IN_PROGRESS' ? 'Resume' : row.oneShot ? 'Start test' : latest ? 'Retry' : 'Start'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
