import { useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { ItemAudio } from './ItemAudio';
import { SubmitBar } from './SubmitBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ListeningConfig {
  audioAssetId?: string;
  instructions?: string;
}

/**
 * Listening test: one audio clip (replayable) and questions about it. Like
 * every other test, items arrive answer-key-stripped and grading happens
 * server-side on submit (AttemptsService.scoreVocabularyTest) — so the score
 * shown afterwards is the server's, not something computed here.
 */
export function ListeningTestPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const config = started.exercise.config as ListeningConfig;
  const items = started.items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ rawScore: number | null; maxScore: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unanswered = items.filter((item) => !answers[item.id]?.trim()).length;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const attempt = await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: {},
        itemResponses: items.map((item) => ({ itemId: item.id, given: answers[item.id] ?? '' })),
      });
      setResult(attempt as { rawScore: number | null; maxScore: number | null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const pct = result.rawScore !== null && result.maxScore ? Math.round((result.rawScore / result.maxScore) * 100) : null;
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Listening Test — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pct !== null && <p className="text-2xl font-semibold">{pct}%</p>}
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{started.exercise.title}</span>
          <Badge variant="secondary">{items.length} questions</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {config.instructions && <p className="text-sm text-muted-foreground">{config.instructions}</p>}
        {config.audioAssetId && <ItemAudio assetId={config.audioAssetId} token={control.getToken()} />}
        {items.map((item, i) => (
          <div key={item.id} className="space-y-1.5">
            {/* Offline dictionary select-and-look-up (spec §6.1). */}
            <p data-dictionary-scope className="text-sm font-medium">
              {i + 1}. {item.prompt}
            </p>
            {item.choices.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={answers[item.id] === choice}
                    onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: choice }))}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      answers[item.id] === choice ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent'
                    }`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                aria-label={`Answer to question ${i + 1}`}
                value={answers[item.id] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                placeholder="Your answer"
              />
            )}
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <SubmitBar submitting={submitting} onSubmit={() => void submit()} note={unanswered > 0 ? `${unanswered} unanswered` : undefined} />
      </CardContent>
    </Card>
  );
}
