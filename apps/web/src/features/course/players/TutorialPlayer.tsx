import { useState } from 'react';
import { Play } from 'lucide-react';
import { expectedAnswer, gradeItem } from '@lab/shared';
import { CourseItemView } from '../CourseItemView';
import { RichText } from '../RichText';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Ser 10 "step by step tutorial with test-as-you-learn features": each step
 * explains a point with examples to listen to, then asks its check
 * questions, answered and marked on the spot before the next step opens.
 */
export function TutorialPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const steps = activity.steps ?? [];
  const [stepIndex, setStepIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const step = steps[stepIndex];
  if (!step) return <p className="text-sm text-muted-foreground">This tutorial has no steps.</p>;

  const byId = new Map(activity.items.map((i) => [i.id, i]));
  const checks = (step.checkItemIds ?? []).map((id) => byId.get(id)).filter((i) => i !== undefined);
  const allChecked = checks.every((i) => checked.has(i.id));
  const last = stepIndex === steps.length - 1;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-1.5" aria-label="Tutorial steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              disabled={i > stepIndex}
              onClick={() => setStepIndex(i)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                i === stepIndex ? 'border-brand bg-brand text-brand-ink' : i < stepIndex ? 'border-brand/40 text-brand' : 'text-muted-foreground',
              )}
            >
              {i + 1}. {s.title}
            </button>
          </li>
        ))}
      </ol>

      <section className="space-y-3">
        <h3 className="text-xl font-semibold">{step.title}</h3>
        {step.body.map((para, i) => (
          <p key={i} className="leading-relaxed">
            <RichText text={para} />
          </p>
        ))}
        {step.examples && step.examples.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {step.examples.map((ex, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => void speech.play(ex.speech, { id: `ex:${stepIndex}:${i}` })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-control border px-3 py-2 text-left hover:bg-accent',
                    speech.playing === `ex:${stepIndex}:${i}` && 'border-brand bg-brand/10',
                  )}
                >
                  <Play className="h-4 w-4 shrink-0 text-brand" />
                  <span>
                    <span className="block font-medium">{ex.speech.map((l) => l.text).join(' ')}</span>
                    {ex.note && <span className="block text-xs text-muted-foreground">{ex.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {checks.length > 0 && (
        <section className="space-y-5 rounded-card border border-hairline bg-cream/40 p-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Check your understanding</h4>
          {checks.map((item) => {
            const isChecked = checked.has(item.id);
            return (
              <div key={item.id} className="space-y-2">
                <CourseItemView
                  item={item}
                  value={answers[item.id]}
                  onChange={(v) => setAnswer(item.id, v)}
                  speech={speech}
                  control={control}
                  attemptId={attemptId}
                  disabled={isChecked}
                  reveal={isChecked ? { correct: gradeItem(item, answers[item.id]), expected: expectedAnswer(item), explain: 'explain' in item ? item.explain : undefined } : null}
                />
                {!isChecked && (
                  <Button size="sm" disabled={!answers[item.id]?.trim()} onClick={() => setChecked((prev) => new Set(prev).add(item.id))}>
                    Check
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="flex justify-between border-t border-hairline pt-4">
        <Button variant="ghost" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)}>
          Previous step
        </Button>
        {last ? (
          <Button disabled={!allChecked || submitting} onClick={() => onSubmit()}>
            {submitting ? 'Saving…' : 'Finish tutorial'}
          </Button>
        ) : (
          <Button disabled={!allChecked} onClick={() => setStepIndex(stepIndex + 1)} title={allChecked ? undefined : 'Answer the check questions first'}>
            Next step
          </Button>
        )}
      </div>
    </div>
  );
}
