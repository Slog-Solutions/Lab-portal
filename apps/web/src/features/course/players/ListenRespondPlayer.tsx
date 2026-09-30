import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { gradeItem, type CourseItem } from '@lab/shared';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Bubble = { who: string; text: string; mine: boolean; verdict?: boolean | null };

/**
 * Ser 10 "A listen and Respond Task — the learners must take the part of
 * one of the speakers and respond by choosing the most suitable option".
 * The other speaker is voiced; at each of the learner's turns they pick a
 * reply, get instant feedback, and the conversation carries on with the
 * right reply spoken in their voice.
 */
export function ListenRespondPlayer({ activity, answers, setAnswer, speech, submitting, onSubmit }: PlayerProps) {
  const dialogue = activity.dialogue ?? [];
  const byId = new Map(activity.items.map((i) => [i.id, i]));
  const [pos, setPos] = useState(-1);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  // True while the chosen reply is being spoken — the turn is over, so its
  // choices must not come back and be answered a second time.
  const [replying, setReplying] = useState(false);
  const runRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  const turn = pos >= 0 ? dialogue[pos] : undefined;
  const item: CourseItem | undefined = turn && 'itemId' in turn ? byId.get(turn.itemId) : undefined;
  const finished = pos >= dialogue.length;

  // Block body on purpose: newer Chromium returns a Promise from
  // scrollIntoView, which React would then call as the effect's cleanup.
  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [bubbles.length, pos]);

  // Speak the other person's lines as they come up, then move on by itself.
  useEffect(() => {
    if (!turn || !('speech' in turn)) return;
    const run = ++runRef.current;
    setBubbles((b) => [...b, { who: turn.speech.speaker ?? '', text: turn.speech.text, mine: false }]);
    void speech.play([turn.speech], { id: `rr:${pos}` }).then(() => {
      if (run === runRef.current) setPos((p) => p + 1);
    });
    // Once per turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  useEffect(() => () => void (runRef.current += 1), []);

  function choose(choice: string): void {
    if (!item || picked) return;
    setPicked(choice);
    setAnswer(item.id, choice);
  }

  async function carryOn(): Promise<void> {
    if (!item || item.kind !== 'choice' || replying) return;
    setReplying(true);
    const reply = item.answer ?? picked ?? '';
    const ok = gradeItem(item, picked ?? undefined);
    setBubbles((b) => [...b, { who: 'You', text: reply, mine: true, verdict: ok }]);
    setPicked(null);
    await speech.play([{ text: reply, voice: 'en_US' }], { id: `rr:me:${pos}` });
    setReplying(false);
    setPos((p) => p + 1);
  }

  if (pos < 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">Listen to the other person. When it is your turn, choose what you would say.</p>
        <Button size="lg" onClick={() => setPos(0)}>
          <Play className="mr-2 h-4 w-4" /> Start the conversation
        </Button>
      </div>
    );
  }

  const verdict = item && picked ? gradeItem(item, picked) : null;

  return (
    <div className="space-y-4">
      <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-card border border-hairline bg-cream/30 p-4">
        {bubbles.map((b, i) => (
          <div key={i} className={cn('flex', b.mine ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[80%] rounded-card px-4 py-2', b.mine ? 'bg-brand text-brand-ink' : 'border border-hairline bg-card')}>
              <p className="text-xs opacity-70">{b.who}</p>
              <p>{b.text}</p>
              {b.mine && b.verdict === false && <p className="mt-1 text-xs opacity-80">(The best reply is shown.)</p>}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {item && item.kind === 'choice' && !replying && (
        <div className="space-y-3">
          <p className="font-medium">Your turn — what do you say?</p>
          <div className="grid gap-2">
            {item.choices.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!!picked}
                onClick={() => choose(c)}
                className={cn(
                  'rounded-control border px-4 py-3 text-left transition-colors hover:bg-accent disabled:hover:bg-transparent',
                  picked === c && verdict === true && 'border-status-online bg-status-online/10',
                  picked === c && verdict === false && 'border-destructive bg-destructive/10',
                  picked && picked !== c && item.answer === c && 'border-status-online',
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {picked && (
            <div className="flex items-center justify-between gap-2">
              <p className={cn('text-sm font-medium', verdict ? 'text-status-online' : 'text-destructive')}>
                {verdict ? 'Good reply!' : `A better reply: "${item.answer}"`}
              </p>
              <Button onClick={() => void carryOn()}>Continue</Button>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="flex items-center justify-between border-t border-hairline pt-4">
          <p className="text-sm text-muted-foreground">
            End of the conversation — {activity.items.filter((i) => gradeItem(i, answers[i.id])).length} of {activity.items.length} best replies.
          </p>
          <Button disabled={submitting} onClick={() => onSubmit()}>
            {submitting ? 'Saving…' : 'Finish'}
          </Button>
        </div>
      )}
    </div>
  );
}
