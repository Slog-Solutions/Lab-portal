import { useMemo, useState } from 'react';
import { writeRequirements } from '@lab/shared';
import { CourseItemView, SpeechButtons } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * A CEFR worksheet (Ser 10 "all four key skills"): one topic worked through
 * as reading, listening, language, speaking and writing parts on a single
 * scrolling page. No feedback until the end — it is a test. The learner's
 * own checklist is for self-review only; nothing about it is sent.
 */
export function WritingPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const parts = activity.writing?.parts ?? [];
  const byId = useMemo(() => new Map(activity.items.map((i) => [i.id, i])), [activity.items]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const passage = activity.passage;
  const paragraphs = passage?.text.split(/\n\s*\n/) ?? [];
  const passageAudio = useMemo(
    () => paragraphs.map((text) => ({ text, voice: 'en_GB' as const })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [passage?.text],
  );

  const gradable = activity.items.filter((i) => i.kind !== 'record');
  const answered = gradable.filter((i) => answers[i.id]?.trim()).length;
  const write = activity.items.find((i) => i.kind === 'write');
  const writeOk = write?.kind === 'write' ? writeRequirements(write, answers[write.id] ?? '').met : true;

  return (
    <div className="space-y-8">
      {parts.map((part, n) => (
        <section key={part.title} className="space-y-4">
          <header>
            <h3 className="text-lg font-semibold">
              Part {n + 1} — {part.title}
            </h3>
            {part.instructions && <p className="text-sm text-muted-foreground">{part.instructions}</p>}
          </header>

          {part.title === 'Reading' && passage && (
            <article className="space-y-3 rounded-card border border-hairline bg-cream/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold">{passage.title}</h4>
                <SpeechButtons lines={passageAudio} speech={speech} id="worksheet-text" label="Listen to the text" />
              </div>
              {paragraphs.map((para, i) => (
                <p key={i} className="whitespace-pre-line leading-relaxed">
                  {para}
                </p>
              ))}
            </article>
          )}

          <ol className="space-y-6">
            {part.itemIds.map((id, i) => {
              const item = byId.get(id);
              if (!item) return null;
              return (
                <li key={id} className="flex gap-3">
                  {part.itemIds.length > 1 && <span className="mt-0.5 w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>}
                  <div className="min-w-0 flex-1">
                    <CourseItemView
                      item={item}
                      value={answers[id]}
                      onChange={(v) => setAnswer(id, v)}
                      speech={speech}
                      control={control}
                      attemptId={attemptId}
                    />
                  </div>
                </li>
              );
            })}
          </ol>

          {part.title === 'Writing' && activity.writing && (
            <div className="rounded-card border border-hairline p-4">
              <p className="mb-2 text-sm font-medium">Before you hand in, check your writing:</p>
              <ul className="space-y-2">
                {activity.writing.checklist.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      id={`chk-${c}`}
                      checked={ticked.has(c)}
                      onCheckedChange={(on) =>
                        setTicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(c);
                          else next.delete(c);
                          return next;
                        })
                      }
                    />
                    <label htmlFor={`chk-${c}`} className="leading-snug">
                      {c}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <span className="text-sm text-muted-foreground">
          {answered} of {gradable.length} answered{writeOk ? '' : ' — the writing task is not complete yet'}
        </span>
        <Button disabled={submitting} onClick={() => onSubmit()}>
          {submitting ? 'Submitting…' : 'Hand in the worksheet'}
        </Button>
      </div>
    </div>
  );
}
