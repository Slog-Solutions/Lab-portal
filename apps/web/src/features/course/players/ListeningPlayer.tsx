import { useState } from 'react';
import { Headphones, Snail, Square } from 'lucide-react';
import { CourseItemView } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';

/**
 * Listening tasks (Ser 10): one recording, questions on screen. The
 * transcript stays hidden until the results. `note-taking` renders the
 * items as a form; a General Listening task shows its gist questions
 * first and opens the detail questions only after them.
 */
export function ListeningPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const script = activity.script ?? [];
  const [plays, setPlays] = useState(0);
  const [line, setLine] = useState<number | null>(null);
  const hasPhases = activity.items.some((i) => i.kind === 'choice' && i.phase);
  const [stage, setStage] = useState<'gist' | 'detail'>('gist');
  const gist = activity.items.filter((i) => i.kind === 'choice' && i.phase === 'gist');
  const shown = !hasPhases ? activity.items : stage === 'gist' ? gist : activity.items.filter((i) => !(i.kind === 'choice' && i.phase === 'gist'));
  const answered = activity.items.filter((i) => answers[i.id]?.trim()).length;
  const playing = speech.playing === 'listening' || speech.playing === 'listening:slow';

  async function play(slow: boolean): Promise<void> {
    setPlays((n) => n + 1);
    await speech.play(script, { id: slow ? 'listening:slow' : 'listening', rate: slow ? 0.8 : 1, gapMs: 450, onLine: setLine });
    setLine(null);
  }

  const form = activity.kind === 'note-taking' && activity.form;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-hairline bg-cream/40 p-4">
        <Headphones className="h-6 w-6 text-brand" />
        {playing ? (
          <Button variant="outline" onClick={() => speech.stop()}>
            <Square className="mr-1.5 h-4 w-4" /> Stop
          </Button>
        ) : (
          <>
            <Button onClick={() => void play(false)}>{plays === 0 ? 'Play the recording' : 'Play again'}</Button>
            <Button variant="outline" onClick={() => void play(true)}>
              <Snail className="mr-1.5 h-4 w-4" /> Slowly
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">
          {playing && line !== null && script[line]?.speaker ? `${script[line]!.speaker} is speaking…` : plays > 0 ? `Played ${plays}×` : 'Read the questions first.'}
        </span>
      </div>

      {hasPhases && (
        <p className="text-sm font-medium">
          {stage === 'gist' ? 'Part 1 — the main idea (gist)' : 'Part 2 — the details. Listen again if you need to.'}
        </p>
      )}

      {form ? (
        <section className="rounded-card border-2 border-dashed border-hairline p-5">
          <h3 className="mb-1 text-lg font-semibold">{form.title}</h3>
          {form.instructions && <p className="mb-4 text-xs text-muted-foreground">{form.instructions}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {shown.map((item) => (
              <CourseItemView key={item.id} item={item} value={answers[item.id]} onChange={(v) => setAnswer(item.id, v)} speech={speech} control={control} attemptId={attemptId} />
            ))}
          </div>
        </section>
      ) : (
        <ol className="space-y-6">
          {shown.map((item, i) => (
            <li key={item.id} className="flex gap-3">
              <span className="mt-0.5 w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>
              <div className="flex-1">
                <CourseItemView item={item} value={answers[item.id]} onChange={(v) => setAnswer(item.id, v)} speech={speech} control={control} attemptId={attemptId} />
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <span className="text-xs text-muted-foreground">
          {answered} of {activity.items.length} answered
        </span>
        {hasPhases && stage === 'gist' ? (
          <Button disabled={gist.some((g) => !answers[g.id])} onClick={() => setStage('detail')}>
            Next: detail questions
          </Button>
        ) : (
          <div className="flex gap-2">
            {hasPhases && (
              <Button variant="ghost" onClick={() => setStage('gist')}>
                Back to part 1
              </Button>
            )}
            <Button disabled={submitting} onClick={() => onSubmit()}>
              {submitting ? 'Submitting…' : 'Submit answers'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
