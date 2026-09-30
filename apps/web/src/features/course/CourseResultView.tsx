import { Check, Clock, Gauge, Play, RotateCcw, Target, X } from 'lucide-react';
import type { CourseItem, CourseResultView as Result } from '@lab/shared';
import type { CourseSpeechApi } from './use-course-speech';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function itemLabel(item: CourseItem | undefined): string {
  if (!item) return '';
  switch (item.kind) {
    case 'gap':
      return item.text;
    case 'stress':
      return item.prompt && !item.prompt.startsWith('Listen') ? item.prompt : item.units.join(item.units.every((u) => !u.includes(' ')) && item.units.length < 6 ? '·' : ' ');
    case 'field':
      return item.label;
    default:
      return item.prompt ?? '';
  }
}

function givenLabel(item: CourseItem | undefined, given: string | null): string {
  if (given === null || given === '') return '(no answer)';
  if (item?.kind === 'stress') return item.units[Number(given)] ?? given;
  if (item?.kind === 'multi') return given.split('|').join(', ');
  if (item?.kind === 'record') return 'Recorded';
  if (item?.kind === 'write') return `${given.trim().split(/\s+/).length} words written`;
  return given;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The results screen (Ser 10 "Result Tracking" / "Follow up quiz"): score,
 * every question with the right answer, and the areas the mistakes point
 * to — each with a button straight into the activity that teaches it.
 */
export function CourseResultView({
  result,
  speech,
  onRetry,
  onOpenActivity,
  onBack,
}: {
  result: Result;
  speech: CourseSpeechApi | null;
  onRetry?: () => void;
  onOpenActivity?: (key: string) => void;
  onBack?: () => void;
}) {
  const byId = new Map(result.activity.items.map((i) => [i.id, i]));
  // Listening tasks: the transcript is only revealed here, after submitting.
  const transcript = result.activity.script ?? (result.activity.dialogue ?? []).flatMap((t) => ('speech' in t ? [t.speech] : []));
  const tone = result.score >= 80 ? 'text-status-online' : result.score >= 50 ? 'text-status-pending' : 'text-destructive';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Your score</p>
          <p className={cn('text-5xl font-bold', tone)}>{Math.round(result.score)}%</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {result.total > 0 && (
            <span className="flex items-center gap-1">
              <Check className="h-4 w-4" /> {result.correct} of {result.total} correct
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" /> {formatDuration(result.metrics.durationMs)}
          </span>
          {result.metrics.wpm !== undefined && (
            <span className="flex items-center gap-1">
              <Gauge className="h-4 w-4" /> {result.metrics.wpm} words/min
            </span>
          )}
          {result.metrics.wpm !== undefined && (
            // Speed that counts: words per minute actually understood.
            <span className="flex items-center gap-1" title="Reading speed × comprehension">
              Effective speed {Math.round((result.metrics.wpm * result.score) / 100)} words/min
            </span>
          )}
          <span className="flex items-center gap-1">
            <Target className="h-4 w-4" /> Best {result.best !== null ? `${Math.round(result.best)}%` : '—'} · {result.attempts}{' '}
            {result.attempts === 1 ? 'attempt' : 'attempts'}
          </span>
        </div>
      </div>

      {result.reviewAreas.length > 0 && (
        <section className="space-y-2 rounded-card border border-status-pending/40 bg-status-pending/5 p-4">
          <h3 className="font-semibold">Areas to review</h3>
          <p className="text-sm text-muted-foreground">Your mistakes point to these areas. Study them, then try again.</p>
          <ul className="space-y-1.5">
            {result.reviewAreas.map((a) => (
              <li key={a.tag} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {a.label} <span className="text-xs text-muted-foreground">— {a.missed} of {a.total} wrong</span>
                </span>
                {a.activityKey && onOpenActivity && a.activityKey !== result.activityKey && (
                  <Button size="sm" variant="outline" onClick={() => onOpenActivity(a.activityKey!)}>
                    Study this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.items.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Your answers</h3>
          <ol className="divide-y divide-hairline rounded-card border border-hairline">
            {result.items.map((r, i) => {
              const item = byId.get(r.itemId);
              const audio = item && 'audio' in item ? item.audio : undefined;
              return (
                <li key={r.itemId} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <span className="mt-0.5 w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                  <span className="mt-0.5 shrink-0">
                    {r.correct === true ? (
                      <Check className="h-4 w-4 text-status-online" />
                    ) : r.correct === false ? (
                      <X className="h-4 w-4 text-destructive" />
                    ) : (
                      <Badge variant="outline">Spoken</Badge>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block">{itemLabel(item)}</span>
                    <span className="block text-muted-foreground">
                      You: {givenLabel(item, r.given)}
                      {r.correct === false && item?.kind === 'write' && (
                        <> · Needs at least {item.minWords} words{item.mustUse?.length ? ` and ${item.mustUseMin ?? item.mustUse.length} of: ${item.mustUse.join(', ')}` : ''}</>
                      )}
                      {r.correct === false && r.expected !== null && item?.kind !== 'write' && (
                        <>
                          {' '}
                          · Answer: <span className="font-medium text-foreground">{r.expected}</span>
                        </>
                      )}
                    </span>
                    {r.explain && <span className="block text-xs text-muted-foreground">{r.explain}</span>}
                  </span>
                  {audio && speech && (
                    <Button size="icon" variant="ghost" title="Listen" onClick={() => void speech.play(audio, { id: `res:${r.itemId}`, gapMs: 350 })}>
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {result.items.some((r) => byId.get(r.itemId)?.kind === 'write') && (
        <section className="space-y-3">
          <h3 className="font-semibold">Your writing</h3>
          <p className="text-xs text-muted-foreground">
            The score checks length and the language the task asked for. It cannot judge how good your writing is — compare it with the model answer and use the checklist, and your teacher can read it.
          </p>
          {result.items.map((r) => {
            const item = byId.get(r.itemId);
            if (item?.kind !== 'write') return null;
            return (
              <div key={r.itemId} className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 rounded-card border border-hairline p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What you wrote</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.given?.trim() ? r.given : '(nothing written)'}</p>
                </div>
                {item.model && (
                  <div className="space-y-1 rounded-card border border-status-online/40 bg-status-online/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model answer</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.model}</p>
                  </div>
                )}
              </div>
            );
          })}
          {result.activity.writing && (
            <div className="rounded-card border border-hairline p-4">
              <p className="mb-1 text-sm font-medium">Check your own writing</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {result.activity.writing.checklist.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {result.activity.passage && (
        <details className="rounded-card border border-hairline p-4">
          <summary className="cursor-pointer font-semibold">Read the text again</summary>
          <div className="mt-3 space-y-3 text-sm leading-relaxed">
            {result.activity.passage.text.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </details>
      )}

      {transcript.length > 0 && (
        <details className="rounded-card border border-hairline p-4">
          <summary className="cursor-pointer font-semibold">Transcript</summary>
          <div className="mt-3 space-y-1.5 text-sm">
            {transcript.map((l, i) => (
              <p key={i}>
                {l.speaker && <span className="font-medium">{l.speaker}: </span>}
                {l.text}
              </p>
            ))}
          </div>
          {speech && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void speech.play(transcript, { id: 'res:transcript', gapMs: 400 })}>
              <Play className="mr-1.5 h-4 w-4" /> Listen while reading
            </Button>
          )}
        </details>
      )}

      {(onRetry || onBack) && (
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Try again{result.activity.mode === 'test' ? ' (new questions)' : ''}
            </Button>
          )}
          {onBack && (
            <Button variant="outline" onClick={onBack}>
              Back to the course
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
