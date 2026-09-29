import { useEffect, useState } from 'react';
import type { AttemptResultView } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTestClock } from './use-test-clock';

/**
 * §8.2 "The waiting screen" and §8.3 "Results screen" (GF-4/GF-5) — the
 * one place both render. No score, no hints, no per-question feedback
 * while WAITING: this component receives only what AttemptsService.getResult
 * actually returns for that state, so there is nothing to accidentally leak
 * — the server-side reveal gate (Attempt.revealAt) is what makes this
 * component's own honesty possible, not the other way around.
 */
export function TestResultView({
  result,
  title,
  onDismiss,
  pastAttempts,
}: {
  result: Extract<AttemptResultView, { status: 'WAITING' | 'RELEASED' }>;
  title?: string;
  onDismiss?: () => void;
  pastAttempts?: Array<{ id: string; rawScore: number | null; maxScore: number | null; startedAt: string }>;
}) {
  if (result.status === 'WAITING') {
    return <WaitingCard result={result} title={title} />;
  }
  return <ReleasedCard result={result} title={title} onDismiss={onDismiss} pastAttempts={pastAttempts} />;
}

function WaitingCard({ result, title }: { result: Extract<AttemptResultView, { status: 'WAITING' }>; title?: string }) {
  const clock = useTestClock({ closesAt: result.closesAt, serverNow: result.serverNow, startedAt: null });
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">{title ?? 'Answers submitted'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          {result.awaiting === 'TEACHER'
            ? 'Your teacher will show the answers when they release the results.'
            : 'Your teacher will show the answers when the time is up.'}
        </p>
        {result.closesAt !== null && (
          <p className="text-3xl font-semibold tabular-nums">{clock.label}</p>
        )}
        <p className="text-xs text-muted-foreground">No score yet — this screen updates on its own, no need to refresh.</p>
      </CardContent>
    </Card>
  );
}

function ReleasedCard({
  result,
  title,
  onDismiss,
  pastAttempts,
}: {
  result: Extract<AttemptResultView, { status: 'RELEASED' }>;
  title?: string;
  onDismiss?: () => void;
  pastAttempts?: Array<{ id: string; rawScore: number | null; maxScore: number | null; startedAt: string }>;
}) {
  const pct = result.rawScore !== null && result.maxScore ? Math.round((result.rawScore / result.maxScore) * 100) : null;
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{title ?? 'Results'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          {pct !== null ? (
            <p className="text-3xl font-semibold">
              You scored {result.rawScore} / {result.maxScore}{' '}
              <span className="text-lg font-normal text-muted-foreground">({pct}%)</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Awaiting review.</p>
          )}
        </div>

        {result.revealDetail !== 'SCORE_ONLY' && (
          <div className="space-y-3">
            {result.items.map((item, i) => (
              <div key={item.itemId} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  {i + 1}. {item.prompt}
                </p>
                {item.choices.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.choices.map((choice) => {
                      const isGiven = choice === item.given;
                      const isCorrect = result.revealDetail === 'FULL_ANSWERS' && choice === item.correctAnswer;
                      return (
                        <span
                          key={choice}
                          className={`rounded-md border px-3 py-1.5 text-sm ${
                            isCorrect
                              ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300'
                              : isGiven
                                ? 'border-destructive bg-destructive/10 text-destructive'
                                : 'border-input'
                          }`}
                        >
                          {choice}
                          {isGiven && ' (your answer)'}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm">
                    Your answer: <span className="font-medium">{item.given || '(blank)'}</span>
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={item.correct ? 'success' : 'destructive'}>{item.correct ? '✓ Correct' : '✗ Incorrect'}</Badge>
                  {result.revealDetail === 'FULL_ANSWERS' && !item.correct && item.correctAnswer && (
                    <span className="text-xs text-muted-foreground">Correct answer: {item.correctAnswer}</span>
                  )}
                </div>
                {result.revealDetail === 'FULL_ANSWERS' && item.explanation && (
                  <p className="mt-2 rounded bg-muted/40 p-2 text-xs text-muted-foreground">{item.explanation}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {pastAttempts && pastAttempts.length > 0 && <PastAttempts attempts={pastAttempts} />}

        {onDismiss && <Button onClick={onDismiss}>Back</Button>}
      </CardContent>
    </Card>
  );
}

function PastAttempts({ attempts }: { attempts: Array<{ id: string; rawScore: number | null; maxScore: number | null; startedAt: string }> }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Past attempts</p>
      <ul className="space-y-1">
        {attempts.map((a) => {
          const pct = a.rawScore !== null && a.maxScore ? Math.round((a.rawScore / a.maxScore) * 100) : null;
          return (
            <li key={a.id} className="flex justify-between text-xs text-muted-foreground">
              <span>{new Date(a.startedAt).toLocaleString()}</span>
              <span>{pct !== null ? `${pct}%` : '—'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** True once `attemptId`'s WAITING screen should re-check the result: at
 * zero on its own countdown, or when a caller bumps `revealSignal` (e.g. a
 * `test:revealed` socket event for this instance). Kept here as a small
 * hook rather than duplicated in both VocabularyTestPlayer and
 * LiveVocabularyTest. */
export function useResultPoll(active: boolean, closesAt: number | null, serverNow: number, revealSignal: number, onDue: () => void): void {
  const clock = useTestClock({ closesAt, serverNow, startedAt: null });
  const [lastSignal, setLastSignal] = useState(revealSignal);
  useEffect(() => {
    if (!active) return;
    if (clock.expired) onDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, clock.expired]);
  useEffect(() => {
    if (!active) return;
    if (revealSignal !== lastSignal) {
      setLastSignal(revealSignal);
      onDue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revealSignal]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(onDue, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
