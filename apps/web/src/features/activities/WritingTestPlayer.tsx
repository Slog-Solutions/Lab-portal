import { useState } from 'react';
import { countWords } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { SubmitBar } from './SubmitBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface WritingConfig {
  instructions?: string;
  minWords?: number;
  maxWords?: number;
}

/**
 * Writing test: the teacher's prompt, a box to write in, a live word count.
 * Nothing is scored here or on the server — the essay is stored and a
 * teacher marks it (see AssessmentsService.grade). The word limits are
 * enforced by the server on submit; the counter below only saves a round trip.
 */
export function WritingTestPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as WritingConfig;
  const item = started.items?.[0];
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = countWords(text);
  const tooShort = words < (config.minWords ?? 1);
  const tooLong = config.maxWords !== undefined && words > config.maxWords;

  async function submit(): Promise<void> {
    if (!item) return;
    setSubmitting(true);
    setError(null);
    try {
      await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: {},
        itemResponses: [{ itemId: item.id, given: text }],
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Writing Test — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Your teacher will read it and give you a mark. You will see it here under My Assignments.</p>
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  if (!item) {
    return <p className="text-sm text-muted-foreground">This test has no prompt.</p>;
  }

  const limits = [config.minWords ? `at least ${config.minWords}` : null, config.maxWords ? `at most ${config.maxWords}` : null].filter(Boolean).join(', ');

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{started.exercise.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {config.instructions && <p className="text-sm text-muted-foreground">{config.instructions}</p>}
        <div className="rounded-md bg-muted/50 p-3">
          {/* Offline dictionary select-and-look-up (spec §6.1). */}
          <p data-dictionary-scope className="whitespace-pre-wrap text-sm font-medium">
            {item.prompt}
          </p>
        </div>
        <div className="space-y-1.5">
          <Textarea
            aria-label="Your answer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="Write your answer here"
            className="resize-y text-base"
          />
          <p className={`text-xs ${tooLong || (words > 0 && tooShort) ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {words} {words === 1 ? 'word' : 'words'}
            {limits && ` — ${limits}`}
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <SubmitBar disabled={tooShort || tooLong} submitting={submitting} onSubmit={() => void submit()} />
      </CardContent>
    </Card>
  );
}
