import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Gauge, Timer } from 'lucide-react';
import { CourseItemView } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

type Stage = 'ready' | 'reading' | 'questions';

/** Words highlighted at once by the pacer — about one eye fixation. */
const PACER_CHUNK = 4;

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Ser 10 "Read Up-Speed Up": the reading is timed (words per minute, worked
 * out by the server from the passage's word count and readingMs), then the
 * passage is hidden while the comprehension questions are answered — speed
 * only counts if the meaning came with it. An optional pacer moves a
 * highlight through the text at a chosen speed, to train faster reading.
 */
export function SpeedReadingPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const passage = activity.passage!;
  const [stage, setStage] = useState<Stage>('ready');
  const [pacer, setPacer] = useState(false);
  const [targetWpm, setTargetWpm] = useState(() => Number(/about (\d+) words/.exec(activity.intro ?? '')?.[1] ?? 180));
  const [now, setNow] = useState(0);
  const [pacerAt, setPacerAt] = useState(0);
  const startRef = useRef(0);
  const [readingMs, setReadingMs] = useState<number | null>(null);

  // Paragraphs of words, with each word's position in the whole text.
  const paragraphs = useMemo(() => {
    let n = 0;
    return passage.text.split(/\n\s*\n/).map((para) => para.split(/\s+/).filter(Boolean).map((w) => ({ w, i: n++ })));
  }, [passage.text]);
  const totalWords = paragraphs.reduce((s, p) => s + p.length, 0);

  useEffect(() => {
    if (stage !== 'reading') return;
    const clock = setInterval(() => setNow(Date.now()), 250);
    const step = pacer ? setInterval(() => setPacerAt((i) => Math.min(i + 1, totalWords)), 60_000 / targetWpm) : undefined;
    return () => {
      clearInterval(clock);
      if (step) clearInterval(step);
    };
  }, [stage, pacer, targetWpm, totalWords]);

  function start(): void {
    startRef.current = Date.now();
    setNow(startRef.current);
    setPacerAt(0);
    setStage('reading');
  }

  function finishReading(): void {
    setReadingMs(Date.now() - startRef.current);
    setStage('questions');
  }

  const elapsed = stage === 'reading' ? now - startRef.current : (readingMs ?? 0);
  const liveWpm = readingMs ? Math.round(passage.wordCount / (readingMs / 60_000)) : null;
  const answered = activity.items.filter((i) => answers[i.id]).length;

  if (stage === 'ready') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-4 rounded-card border border-hairline bg-cream/40 p-4 text-sm">
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-brand" /> {passage.wordCount} words
          </span>
          <span className="flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-brand" /> {activity.items.length} questions afterwards — without the text
          </span>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Press Start. The timer runs while you read.</li>
          <li>Press &quot;I&apos;ve finished reading&quot; as soon as you reach the end.</li>
          <li>Answer the questions. Your result shows your speed and how much you understood.</li>
        </ol>
        <div className="space-y-2 rounded-card border border-hairline p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={pacer} onCheckedChange={(v) => setPacer(v === true)} /> Use the pacer (a highlight that moves at a set speed)
          </label>
          {pacer && (
            <label className="flex flex-wrap items-center gap-3 text-sm">
              Pacer speed
              <input
                type="range"
                min={80}
                max={450}
                step={10}
                value={targetWpm}
                onChange={(e) => setTargetWpm(Number(e.target.value))}
                className="w-56 accent-[var(--color-brand)]"
                aria-label="Pacer speed in words per minute"
              />
              <span className="font-medium">{targetWpm} words/min</span>
            </label>
          )}
        </div>
        <Button size="lg" onClick={start}>
          <Timer className="mr-2 h-4 w-4" /> Start reading
        </Button>
      </div>
    );
  }

  if (stage === 'reading') {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-control border border-hairline bg-card/95 px-4 py-2 backdrop-blur">
          <span className="flex items-center gap-2 font-mono text-lg" aria-live="off">
            <Timer className="h-4 w-4 text-brand" /> {formatClock(elapsed)}
          </span>
          <Button onClick={finishReading}>I&apos;ve finished reading</Button>
        </div>
        <article className="space-y-4 text-lg leading-8">
          <h3 className="text-xl font-semibold">{passage.title}</h3>
          {paragraphs.map((para, p) => (
            <p key={p}>
              {para.map(({ w, i }) => (
                <span
                  key={i}
                  className={cn('rounded px-0.5 transition-colors', pacer && i >= pacerAt && i < pacerAt + PACER_CHUNK && 'bg-brand/20')}
                >
                  {w}{' '}
                </span>
              ))}
            </p>
          ))}
        </article>
        <div className="flex justify-end">
          <Button onClick={finishReading}>I&apos;ve finished reading</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-hairline bg-cream/40 p-4 text-sm">
        You read {passage.wordCount} words in {formatClock(elapsed)}
        {liveWpm !== null && (
          <>
            {' '}
            — about <span className="font-semibold">{liveWpm} words per minute</span>
          </>
        )}
        . Now answer from memory; the text is hidden.
      </div>
      <ol className="space-y-6">
        {activity.items.map((item, n) => (
          <li key={item.id} className="flex gap-3">
            <span className="mt-0.5 w-6 shrink-0 text-sm text-muted-foreground">{n + 1}.</span>
            <div className="flex-1">
              <CourseItemView item={item} value={answers[item.id]} onChange={(v) => setAnswer(item.id, v)} speech={speech} control={control} attemptId={attemptId} />
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <span className="text-xs text-muted-foreground">
          {answered} of {activity.items.length} answered
        </span>
        <Button disabled={submitting || readingMs === null} onClick={() => onSubmit({ readingMs: readingMs ?? undefined })}>
          {submitting ? 'Submitting…' : 'Submit answers'}
        </Button>
      </div>
    </div>
  );
}
