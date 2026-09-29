import { useEffect, useState } from 'react';
import type { AttemptResultView } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt, type StartedAttemptTiming } from '../../lib/station-api';
import { ApiError } from '../../lib/api-client';
import { ItemAudio } from './ItemAudio';
import { TestResultView, useResultPoll } from './vocab/TestResultView';
import { useTestClock } from './vocab/use-test-clock';
import { useAnswerBuffer } from './vocab/use-answer-buffer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const UNTIMED: StartedAttemptTiming = { closesAt: null, serverNow: Date.now(), revealMode: 'ON_SUBMIT', revealDetail: 'SCORE_ONLY', allowReview: true };

/**
 * Ser 5 "Vocabulary Test" — manual entry or ItemBank-backed (Ser 10
 * "large test bank... different set of questions each attempt"). Items
 * arrive from POST /attempts/start already answer-key-stripped (server
 * never sends the correct answer for either serving mode — see
 * AttemptsService.prepareServe's doc comment); grading happens entirely
 * server-side on submit.
 *
 * SPEC-mcq-test-timed-reveal.md (GF-1..GF-6) extends this with a
 * skew-corrected countdown, a review screen, and — the actual point of
 * that spec — a WAITING screen after submit with no score and no hints
 * until AttemptsService.getResult says the attempt is revealed. Used two
 * ways: standalone (AssignmentsPanel/StudyLibraryPanel — `started` comes
 * from a list click, `revealSignal` is never bumped, reveal is purely
 * time/teacher-driven) and wrapped by LiveVocabularyTest for a "Launch in
 * lab" cohort test (which also bumps `revealSignal` on `test:revealed`,
 * for GF-4's "within 2 s" — an individual attempt has no such event and
 * relies on its own countdown reaching zero, which useResultPoll also
 * covers).
 */
export function VocabularyTestPlayer({
  control,
  started,
  onDone,
  revealSignal = 0,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
  revealSignal?: number;
}) {
  const items = started.items ?? [];
  const timing = started.timing ?? UNTIMED;
  const { answers, setAnswer } = useAnswerBuffer(started.attemptId, started.answers ?? {}, (patch) =>
    stationApi.saveAnswers(control.getToken(), started.attemptId, patch),
  );
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResultView | null>(null);

  const clock = useTestClock({ closesAt: timing.closesAt, serverNow: timing.serverNow, startedAt: null });

  async function submit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const itemResponses = items.map((item) => ({ itemId: item.id, given: answers[item.id] ?? '' }));
      const res = (await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: { answers: [], score: null },
        itemResponses,
      })) as AttemptResultView;
      setResult(res);
      clearDraft();
    } catch (err) {
      // The deadline already passed server-side (a slow click, or the
      // sweep beat this request by a beat) — the attempt was still
      // graded, just not by THIS call. Fetch the real result rather than
      // showing a raw error for what is, from the student's point of
      // view, an ordinary submit.
      if (err instanceof ApiError && (err.code === 'TEST_CLOSED' || err.code === 'ALREADY_SUBMITTED')) {
        try {
          setResult(await stationApi.attemptResult(control.getToken(), started.attemptId));
          clearDraft();
        } catch {
          setError('Time is up. Reopen the test to see your result.');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function clearDraft(): void {
    try {
      localStorage.removeItem(`vt:${started.attemptId}`);
    } catch {
      /* best-effort */
    }
  }

  // Auto-submit at zero (§8.1) — whatever's answered counts.
  useEffect(() => {
    if (clock.expired && !result && !submitting) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.expired]);

  // While waiting for reveal: re-check on the 15s fallback, on the
  // waiting screen's own countdown reaching zero, or on revealSignal.
  const waiting = result?.status === 'WAITING' ? result : null;
  useResultPoll(waiting !== null, waiting?.closesAt ?? null, waiting?.serverNow ?? Date.now(), revealSignal, () => {
    void stationApi
      .attemptResult(control.getToken(), started.attemptId)
      .then(setResult)
      .catch(() => void 0);
  });

  if (result && result.status !== 'OPEN') {
    return <TestResultView result={result} title={started.exercise.title} onDismiss={onDone} />;
  }

  const item = items[index];
  if (!item) {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{started.exercise.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">This test has no questions.</p>
        </CardContent>
      </Card>
    );
  }

  const clockBadge = timing.closesAt !== null && (
    <span className={`text-sm font-semibold tabular-nums ${clock.warn ? 'text-destructive' : ''}`}>{clock.label}</span>
  );

  if (reviewing) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Review your answers</span>
            {clockBadge}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                setIndex(i);
                setReviewing(false);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border p-2.5 text-left text-sm hover:bg-accent"
            >
              <span className="truncate">
                {i + 1}. {it.prompt}
              </span>
              <Badge variant={answers[it.id] ? 'secondary' : 'outline'}>{answers[it.id] ? 'Answered' : 'Unanswered'}</Badge>
            </button>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewing(false)}>
              Back
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit test'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const answeredCount = items.filter((i) => (answers[i.id] ?? '').length > 0).length;
  const isLast = index === items.length - 1;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="truncate">{started.exercise.title}</span>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {index + 1} / {items.length}
            </Badge>
            {clockBadge}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-1" aria-hidden>
          {items.map((it, i) => (
            <span
              key={it.id}
              className={`h-1.5 flex-1 rounded-full ${answers[it.id] ? 'bg-primary' : i === index ? 'bg-primary/40' : 'bg-muted'}`}
            />
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{item.prompt}</label>
          {item.mediaAssetId && <ItemAudio assetId={item.mediaAssetId} token={control.getToken()} />}
          {item.choices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {item.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={answers[item.id] === choice}
                  onClick={() => setAnswer(item.id, choice)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    answers[item.id] === choice ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent'
                  }`}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <Input value={answers[item.id] ?? ''} onChange={(e) => setAnswer(item.id, e.target.value)} placeholder="Your answer" />
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            Back
          </Button>
          <span className="shrink-0 text-xs text-muted-foreground">
            {answeredCount} of {items.length} answered
          </span>
          {!isLast ? (
            <Button onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}>Next</Button>
          ) : timing.allowReview ? (
            <Button onClick={() => setReviewing(true)}>Review</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
