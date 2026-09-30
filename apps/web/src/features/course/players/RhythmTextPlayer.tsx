import { Fragment, useEffect, useRef, useState } from 'react';
import { Mic, Play, Repeat, Square } from 'lucide-react';
import { expectedAnswer, gradeItem, type RhythmLine } from '@lab/shared';
import { CourseItemView } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Mode = 'listen' | 'repeat' | 'gaps' | 'record';

const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'listen', label: '1. Listen to the beat' },
  { key: 'repeat', label: '2. Listen and repeat' },
  { key: 'gaps', label: '3. Fill the gaps' },
  { key: 'record', label: '4. Record yourself' },
];

/** "i WANT a CUP of TEA" with the CAPITAL syllables drawn as beats. */
function BeatText({ text }: { text: string }) {
  const parts = text.split(/([A-Z][A-Z']*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^[A-Z]/.test(p) && !(p === 'I' || p === 'A') ? (
          <span key={i} className="font-bold text-brand underline decoration-brand/40 decoration-2 underline-offset-4">
            {p.toLowerCase()}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function LineList({ lines, active, onPlay }: { lines: RhythmLine[]; active: number | null; onPlay?: (i: number) => void }) {
  return (
    <ol className="space-y-1.5">
      {lines.map((line, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={!onPlay}
            onClick={() => onPlay?.(i)}
            className={cn(
              'flex w-full items-baseline gap-3 rounded-control px-3 py-2 text-left text-xl leading-relaxed transition-colors',
              onPlay && 'hover:bg-accent',
              active === i && 'bg-brand/10 ring-1 ring-brand',
            )}
          >
            {line.speaker && <span className="w-20 shrink-0 text-sm font-medium text-muted-foreground">{line.speaker}</span>}
            <span>
              <BeatText text={line.text} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Ser 10 "Rhythm ... video and audio lessons where the learner can listen
 * and repeat the language in the texts in a variety of ways" and "a special
 * recording feature, which allows the learner to build up a set of
 * recordings" (every take lands in My progress → My recordings).
 */
export function RhythmTextPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const lines = activity.rhythm?.lines ?? [];
  const [mode, setMode] = useState<Mode>('listen');
  const [active, setActive] = useState<number | null>(null);
  const [repeating, setRepeating] = useState<{ line: number; yourTurn: boolean } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const repeatRun = useRef(0);
  const gaps = activity.items.filter((i) => i.kind === 'gap');
  const record = activity.items.find((i) => i.kind === 'record');
  const voiced = lines.map((l) => ({ text: l.spoken, voice: l.voice, ...(l.speaker ? { speaker: l.speaker } : {}) }));

  useEffect(() => () => void (repeatRun.current += 1), []);

  function stopAll(): void {
    repeatRun.current += 1;
    setRepeating(null);
    setActive(null);
    speech.stop();
  }

  async function playAll(rate = 1): Promise<void> {
    stopAll();
    await speech.play(voiced, { id: `rhythm:${rate}`, rate, gapMs: 300, onLine: setActive });
    setActive(null);
  }

  /** Line by line: the model says it, then a pause long enough to repeat it. */
  async function listenAndRepeat(): Promise<void> {
    stopAll();
    const run = repeatRun.current;
    for (let i = 0; i < lines.length; i++) {
      if (run !== repeatRun.current) return;
      setRepeating({ line: i, yourTurn: false });
      setActive(i);
      await speech.play([voiced[i]!], { id: `repeat:${i}` });
      if (run !== repeatRun.current) return;
      setRepeating({ line: i, yourTurn: true });
      const words = lines[i]!.spoken.split(/\s+/).length;
      await new Promise((r) => setTimeout(r, Math.max(1800, words * 520)));
    }
    if (run === repeatRun.current) {
      setRepeating(null);
      setActive(null);
    }
  }

  const gapsDone = gaps.filter((g) => checked.has(g.id)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => {
              stopAll();
              setMode(m.key);
            }}
            className={cn('rounded-full border px-3 py-1 text-sm', mode === m.key ? 'border-brand bg-brand text-brand-ink' : 'hover:bg-accent')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'listen' && (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">Listen and follow the beat — the underlined syllables are stressed. Tap a line to hear just that line.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void playAll(1)}>
              <Play className="mr-1.5 h-4 w-4" /> Play the text
            </Button>
            <Button variant="outline" onClick={() => void playAll(0.75)}>
              Slowly
            </Button>
            {speech.playing && (
              <Button variant="ghost" onClick={stopAll}>
                <Square className="mr-1.5 h-4 w-4" /> Stop
              </Button>
            )}
          </div>
          <LineList
            lines={lines}
            active={active}
            onPlay={(i) => {
              stopAll();
              setActive(i);
              void speech.play([voiced[i]!], { id: `line:${i}` }).then(() => setActive(null));
            }}
          />
        </section>
      )}

      {mode === 'repeat' && (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">Each line is played, then there is a pause for you to say it aloud with the same beat.</p>
          <div className="flex flex-wrap items-center gap-2">
            {repeating ? (
              <Button variant="outline" onClick={stopAll}>
                <Square className="mr-1.5 h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button onClick={() => void listenAndRepeat()}>
                <Repeat className="mr-1.5 h-4 w-4" /> Start listen and repeat
              </Button>
            )}
            {repeating && (
              <span className={cn('rounded-full px-3 py-1 text-sm font-medium', repeating.yourTurn ? 'bg-status-online/15 text-status-online' : 'bg-muted')}>
                {repeating.yourTurn ? 'Your turn — say it!' : 'Listen…'}
              </span>
            )}
          </div>
          <LineList lines={lines} active={active} />
        </section>
      )}

      {mode === 'gaps' && (
        <section className="space-y-5">
          <p className="text-sm text-muted-foreground">
            The small words between the beats are the hardest to hear. Listen and fill them in ({gapsDone}/{gaps.length} checked).
          </p>
          {gaps.map((item) => {
            const isChecked = checked.has(item.id);
            return (
              <div key={item.id} className="space-y-2 rounded-card border border-hairline p-4">
                <CourseItemView
                  item={item}
                  value={answers[item.id]}
                  onChange={(v) => setAnswer(item.id, v)}
                  speech={speech}
                  control={control}
                  attemptId={attemptId}
                  disabled={isChecked}
                  reveal={isChecked ? { correct: gradeItem(item, answers[item.id]), expected: expectedAnswer(item), explain: item.explain } : null}
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

      {mode === 'record' && record && (
        <section className="space-y-4">
          <LineList lines={lines} active={null} />
          <div className="rounded-card border border-hairline p-4">
            <CourseItemView
              item={record}
              value={answers[record.id]}
              onChange={(v) => setAnswer(record.id, v)}
              speech={speech}
              control={control}
              attemptId={attemptId}
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mic className="h-3.5 w-3.5" /> Every recording you save is kept in My progress → My recordings, so you can hear how you improve.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <span className="text-xs text-muted-foreground">
          Gaps checked {gapsDone}/{gaps.length} · {record && answers[record.id] ? 'Recording saved' : 'Not recorded yet'}
        </span>
        <Button disabled={submitting} onClick={() => onSubmit()}>
          {submitting ? 'Saving…' : 'Finish this text'}
        </Button>
      </div>
    </div>
  );
}
