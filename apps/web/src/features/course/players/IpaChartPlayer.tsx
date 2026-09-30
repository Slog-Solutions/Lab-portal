import { useState } from 'react';
import { Play } from 'lucide-react';
import type { IpaPhoneme } from '@lab/shared';
import { MarkedExample } from '../RichText';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const GROUPS: Array<{ key: IpaPhoneme['group']; title: string }> = [
  { key: 'short-vowel', title: 'Short vowels' },
  { key: 'long-vowel', title: 'Long vowels' },
  { key: 'diphthong', title: 'Diphthongs' },
  { key: 'consonant', title: 'Consonants' },
];

/** Ser 10 "The international Phonemic alphabet": every symbol, tap to hear
 * its example words (with their IPA from eSpeak-NG) and try them yourself. */
export function IpaChartPlayer({ activity, speech, submitting, onSubmit }: PlayerProps) {
  const phonemes = activity.phonemes ?? [];
  const [selected, setSelected] = useState<IpaPhoneme | null>(phonemes[0] ?? null);
  const [explored, setExplored] = useState<Set<string>>(new Set(selected ? [selected.symbol] : []));
  const [ipa, setIpa] = useState<Record<string, string | null>>({});

  function open(p: IpaPhoneme): void {
    setSelected(p);
    setExplored((prev) => new Set(prev).add(p.symbol));
    void speech.play(p.examples.map((e) => ({ text: e.replace(/[[\]]/g, '') })), { id: `ipa:${p.symbol}`, gapMs: 500 });
    for (const e of p.examples) {
      const word = e.replace(/[[\]]/g, '');
      if (ipa[word] === undefined) void speech.ipa(word).then((v) => setIpa((prev) => ({ ...prev, [word]: v })));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.key}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h4>
            <div className="flex flex-wrap gap-1.5">
              {phonemes
                .filter((p) => p.group === g.key)
                .map((p) => (
                  <button
                    key={p.symbol}
                    type="button"
                    onClick={() => open(p)}
                    title={p.examples.map((e) => e.replace(/[[\]]/g, '')).join(', ')}
                    className={cn(
                      'min-w-[3.25rem] rounded-control border px-2 py-2 font-serif text-xl transition-colors hover:bg-accent',
                      selected?.symbol === p.symbol && 'border-brand bg-brand text-brand-ink hover:bg-brand',
                      selected?.symbol !== p.symbol && explored.has(p.symbol) && 'border-brand/40',
                      p.voiced === false && 'italic',
                    )}
                  >
                    /{p.symbol}/
                  </button>
                ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">Consonants in italics are voiceless — no vibration in the throat.</p>
      </div>

      <aside className="space-y-4 rounded-card border border-hairline p-4">
        {selected ? (
          <>
            <p className="text-center font-serif text-5xl">/{selected.symbol}/</p>
            <ul className="space-y-2">
              {selected.examples.map((e) => {
                const word = e.replace(/[[\]]/g, '');
                return (
                  <li key={e}>
                    <button
                      type="button"
                      onClick={() => void speech.play([{ text: word }], { id: `w:${word}` })}
                      className="flex w-full items-center justify-between rounded-control border px-3 py-2 text-left hover:bg-accent"
                    >
                      <span className="text-lg">
                        <MarkedExample text={e} />
                      </span>
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        {ipa[word] ? `/${ipa[word]}/` : ''}
                        <Play className="h-4 w-4 text-brand" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected.tip && <p className="text-sm text-muted-foreground">{selected.tip}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Tap a symbol.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Explored {explored.size} of {phonemes.length} sounds.
        </p>
        <Button className="w-full" disabled={submitting} onClick={() => onSubmit()}>
          {submitting ? 'Saving…' : "I've explored the chart"}
        </Button>
        {speech.error && <p className="text-xs text-status-pending">{speech.error}</p>}
      </aside>
    </div>
  );
}
