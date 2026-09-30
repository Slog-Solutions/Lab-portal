import { useEffect, useState } from 'react';
import { expectedAnswer, gradeItem } from '@lab/shared';
import { CourseItemView, type ItemReveal } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';

/**
 * One item at a time. Practice mode is "test-as-you-learn": Check shows
 * right/wrong and the explanation straight away. Test mode gives no
 * feedback — the student can move back and forth, then submits once.
 */
export function QuizPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const items = activity.items;
  const item = items[index];
  const practice = activity.mode === 'practice';

  useEffect(() => {
    const next = items[index + 1];
    if (next && 'audio' in next && next.audio) speech.prefetch(next.audio);
  }, [index, items, speech]);

  if (!item) return <p className="text-sm text-muted-foreground">This activity has no questions.</p>;

  const value = answers[item.id];
  const isChecked = checked.has(item.id);
  const reveal: ItemReveal | null =
    practice && isChecked ? { correct: gradeItem(item, value), expected: expectedAnswer(item), explain: 'explain' in item ? item.explain : undefined } : null;
  const last = index === items.length - 1;
  const answered = items.filter((i) => answers[i.id]?.trim()).length;

  function check(): void {
    setChecked((prev) => new Set(prev).add(item!.id));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {index + 1} of {items.length}
        </span>
        <span>{answered} answered</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-brand transition-all" style={{ width: `${((index + 1) / items.length) * 100}%` }} />
      </div>

      <CourseItemView
        key={item.id}
        item={item}
        value={value}
        onChange={(v) => setAnswer(item.id, v)}
        speech={speech}
        control={control}
        attemptId={attemptId}
        disabled={practice && isChecked}
        reveal={reveal}
        autoPlay
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <Button type="button" variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Back
        </Button>
        <div className="flex gap-2">
          {practice && !isChecked && item.kind !== 'record' ? (
            <Button type="button" disabled={!value?.trim()} onClick={check}>
              Check
            </Button>
          ) : last ? (
            <Button type="button" disabled={submitting} onClick={() => onSubmit()}>
              {submitting ? 'Submitting…' : 'Finish and see my score'}
            </Button>
          ) : (
            <Button type="button" onClick={() => setIndex(index + 1)}>
              Next
            </Button>
          )}
          {!practice && !last && (
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onSubmit()}>
              Submit now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
