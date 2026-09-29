import { useEffect, useRef, useState } from 'react';
import type { AttemptResultView, TimedTestState } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { ApiError } from '../../lib/api-client';
import { VocabularyTestPlayer } from './VocabularyTestPlayer';
import { TestResultView } from './vocab/TestResultView';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'not-started' }
  | { kind: 'answering'; started: StartedAttempt }
  | { kind: 'result'; result: AttemptResultView }
  | { kind: 'closed' }
  | { kind: 'error'; message: string };

/**
 * SPEC-mcq-test-timed-reveal.md §6.1/§8 — a "Launch in lab" cohort test's
 * student-side wrapper. Mounted by StudentConsole with `key={activityInstanceId}`
 * so a genuinely new test always gets a fresh instance of this component
 * (see resolvedRef below for why that matters); StudentConsole also keeps
 * rendering this component (from its own `heldTest` state) after the
 * teacher ends the session, so the waiting/results screen survives that —
 * see StudentConsole's own doc comment on `heldTest`.
 *
 * `timedTest` is re-derived from every fresh snapshot (session:snapshot is
 * always authoritative — §4.1 "reveal state comes from the server on every
 * load"), but this component only uses it to decide HOW TO START: once an
 * attempt exists (`answering`) or a final result is showing (`result`),
 * later snapshot changes are ignored (`resolvedRef`) — VocabularyTestPlayer
 * owns its own countdown/reveal-poll from that point on, using the
 * timing it got back from /attempts/start, not this component's re-reads
 * of the snapshot.
 */
export function LiveVocabularyTest({
  control,
  timedTest,
  revealSignal,
  onDismiss,
}: {
  control: StationControlClient;
  timedTest: TimedTestState;
  /** Bumped by StudentConsole when a `test:revealed` event names this
   * instance — passed straight through to VocabularyTestPlayer. */
  revealSignal: number;
  onDismiss: () => void;
}) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return; // already answering or showing a result — see doc comment above
    let cancelled = false;

    if (timedTest.status === 'READY') {
      setState({ kind: 'not-started' });
      return;
    }
    if (timedTest.status === 'CLOSED' && !timedTest.revealed) {
      // Closed but not yet finalized (or closed without reveal) — the next
      // snapshot with revealed:true re-runs this effect.
      setState({ kind: 'closed' });
      return;
    }

    setState({ kind: 'loading' });
    void (async () => {
      try {
        const started = await stationApi.startAttempt(control.getToken(), { activityInstanceId: timedTest.activityInstanceId });
        if (cancelled) return;
        resolvedRef.current = true;
        setState({ kind: 'answering', started });
      } catch (err) {
        if (cancelled) return;
        const attemptId = err instanceof ApiError && typeof err.details?.attemptId === 'string' ? err.details.attemptId : null;
        if (err instanceof ApiError && err.code === 'ALREADY_SUBMITTED' && attemptId) {
          try {
            const result = await stationApi.attemptResult(control.getToken(), attemptId);
            if (cancelled) return;
            resolvedRef.current = true;
            setState({ kind: 'result', result });
          } catch {
            if (!cancelled) setState({ kind: 'error', message: 'Could not load your result.' });
          }
          return;
        }
        if (err instanceof ApiError && (err.code === 'TEST_CLOSED' || err.code === 'TEST_NOT_STARTED')) {
          setState({ kind: 'closed' });
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not open this test' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [control, timedTest.activityInstanceId, timedTest.status, timedTest.revealed]);

  if (state.kind === 'answering') {
    return <VocabularyTestPlayer control={control} started={state.started} onDone={onDismiss} revealSignal={revealSignal} />;
  }
  if (state.kind === 'result' && state.result.status !== 'OPEN') {
    return <TestResultView result={state.result} title={timedTest.title} onDismiss={onDismiss} />;
  }
  if (state.kind === 'not-started') {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{timedTest.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Get ready — your teacher will start the test in a moment.</p>
        </CardContent>
      </Card>
    );
  }
  if (state.kind === 'closed') {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{timedTest.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">This test is closed.</p>
        </CardContent>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{timedTest.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{state.message}</p>
        </CardContent>
      </Card>
    );
  }
  return null; // loading — no flash of anything before the first resolution
}
