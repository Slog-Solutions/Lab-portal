import { useEffect, useRef, useState } from 'react';
import { Flame, Heart, Play, Trophy } from 'lucide-react';
import { gradeItem } from '@lab/shared';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LIVES = 3;

/**
 * Ser 10 "Similar sounds ... The game-style format": hear one word, tap
 * which of the pair it was. Practice mode keeps score, a streak and three
 * lives; the mixed challenge (test mode, no answer key on the seat) plays
 * the same round without feedback and reveals everything at the end.
 */
export function PairsGamePlayer({ activity, answers, setAnswer, speech, submitting, onSubmit }: PlayerProps) {
  const items = activity.items;
  const practice = activity.mode === 'practice';
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [flash, setFlash] = useState<{ choice: string; correct: boolean | null } | null>(null);
  const [started, setStarted] = useState(false);
  const submittedRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const item = items[index];
  const over = index >= items.length || (practice && lives <= 0);

  useEffect(() => {
    if (!started || over || !item || item.kind !== 'choice' || !item.audio) return;
    void speech.play(item.audio, { id: item.id });
    const next = items[index + 1];
    if (next && next.kind === 'choice' && next.audio) speech.prefetch(next.audio);
    // Play each word once as it comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, started]);

  useEffect(() => {
    if (over && started && !submittedRef.current) {
      submittedRef.current = true;
      // Short pause so the last flash is seen before the results replace it.
      // Through a ref: the parent's onSubmit changes identity as it re-renders,
      // and a dep on it would clear this timer before it ever fires.
      setTimeout(() => onSubmitRef.current(), 900);
    }
  }, [over, started]);

  const score = items.slice(0, index).filter((i) => gradeItem(i, answers[i.id]) === true).length;

  if (!started) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          {items.length} words. Listen to each one and tap the word you hear.
          {practice ? ` You have ${LIVES} lives — build a streak!` : ' Your score is shown at the end.'}
        </p>
        <Button size="lg" onClick={() => setStarted(true)}>
          <Play className="mr-2 h-4 w-4" /> Start the game
        </Button>
      </div>
    );
  }

  if (over || !item || item.kind !== 'choice') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Trophy className="h-10 w-10 text-brand" />
        <p className="text-lg font-semibold">{practice && lives <= 0 ? 'Out of lives!' : 'Round complete!'}</p>
        {practice && <p className="text-sm text-muted-foreground">Best streak: {bestStreak}</p>}
        <p className="text-sm text-muted-foreground">{submitting ? 'Saving your score…' : 'Working out your score…'}</p>
      </div>
    );
  }

  function answer(choice: string): void {
    if (flash || !item) return;
    setAnswer(item.id, choice);
    const correct = practice ? gradeItem(item, choice) : null;
    setFlash({ choice, correct });
    if (correct === true) {
      setStreak((s) => {
        setBestStreak((b) => Math.max(b, s + 1));
        return s + 1;
      });
    } else if (correct === false) {
      setStreak(0);
      setLives((l) => l - 1);
    }
    setTimeout(() => {
      setFlash(null);
      setIndex((i) => i + 1);
    }, practice ? 1100 : 400);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Word {index + 1} / {items.length}
        </span>
        {practice && (
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 font-medium" title="Score">
              <Trophy className="h-4 w-4 text-brand" /> {score}
            </span>
            <span className={cn('flex items-center gap-1 font-medium', streak >= 3 && 'text-status-pending')} title="Streak">
              <Flame className="h-4 w-4" /> {streak}
            </span>
            <span className="flex items-center gap-0.5" aria-label={`${lives} lives left`}>
              {Array.from({ length: LIVES }, (_, i) => (
                <Heart key={i} className={cn('h-4 w-4', i < lives ? 'fill-destructive text-destructive' : 'text-muted-foreground')} />
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <Button variant="outline" size="lg" onClick={() => item.audio && void speech.play(item.audio, { id: item.id })}>
          <Play className="mr-2 h-4 w-4" /> {speech.playing === item.id ? 'Playing…' : 'Hear it again'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {item.choices.map((c) => {
          const chosen = flash?.choice === c;
          const isAnswer = practice && flash && item.answer === c;
          return (
            <button
              key={c}
              type="button"
              disabled={!!flash}
              onClick={() => answer(c)}
              className={cn(
                'rounded-card border-2 px-4 py-8 text-2xl font-semibold transition-all hover:scale-[1.02] hover:bg-accent disabled:hover:scale-100',
                chosen && flash?.correct === null && 'border-brand bg-brand/10',
                isAnswer && 'border-status-online bg-status-online/15',
                chosen && flash?.correct === false && 'animate-pulse border-destructive bg-destructive/10',
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
      {speech.error && <p className="text-center text-sm text-status-pending">{speech.error}</p>}
    </div>
  );
}
