import { useEffect, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi, type StartedAttempt } from '../../lib/station-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/** Listening-skill items (Ser 10's "four key skills") carry a MediaAsset
 * id (attempts.service.ts's ServedItem, Phase 4) — <audio src> can't
 * carry an Authorization header, so this fetches the same way every other
 * authenticated player asset does (PronunciationPlayer's fetchAsObjectUrl). */
function ItemAudio({ assetId, token }: { assetId: string; token: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(`${serverUrl}/api/media-assets/${assetId}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load audio (${res.status})`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, token]);

  if (!url) return null;
  return <audio controls src={url} className="w-full" />;
}

/**
 * Ser 5 "Vocabulary Test" — manual entry or ItemBank-backed (Ser 10
 * "large test bank... different set of questions each attempt"). Items
 * arrive from POST /attempts/start already answer-key-stripped (server
 * never sends the correct answer for either serving mode — see
 * AttemptsService.prepareServe's doc comment); grading happens entirely
 * server-side on submit.
 */
export function VocabularyTestPlayer({
  control,
  started,
  onDone,
}: {
  control: StationControlClient;
  started: StartedAttempt;
  onDone: () => void;
}) {
  const items = started.items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ rawScore: number | null; maxScore: number | null; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const itemResponses = items.map((item) => ({ itemId: item.id, given: answers[item.id] ?? '' }));
      const attempt = await stationApi.submitAttempt(control.getToken(), started.attemptId, {
        response: { answers: [], score: null },
        itemResponses,
      });
      setResult(attempt as { rawScore: number | null; maxScore: number | null; status: string });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const pct = result.rawScore !== null && result.maxScore ? Math.round((result.rawScore / result.maxScore) * 100) : null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vocabulary Test — Submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pct !== null ? (
            <p className="text-2xl font-semibold">
              {pct}% <span className="text-sm font-normal text-muted-foreground">({result.rawScore}/{result.maxScore})</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Awaiting teacher review.</p>
          )}
          <Button onClick={onDone}>Back to assignments</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{started.exercise.title}</span>
          <Badge variant="secondary">{items.length} items</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item, i) => (
          <div key={item.id} className="space-y-1.5">
            <label className="text-sm font-medium">
              {i + 1}. {item.prompt}
            </label>
            {item.mediaAssetId && <ItemAudio assetId={item.mediaAssetId} token={control.getToken()} />}
            {item.choices.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
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
                value={answers[item.id] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                placeholder="Your answer"
              />
            )}
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </CardContent>
    </Card>
  );
}
