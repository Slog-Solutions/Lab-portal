import { useEffect } from 'react';
import { Check, Mic, Play, Snail, Square, X } from 'lucide-react';
import { MULTI_ANSWER_SEPARATOR, writeRequirements, type CourseItem, type CourseSpeech } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import { useTakeRecorder } from '../activities/use-take-recorder';
import type { CourseSpeechApi } from './use-course-speech';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface ItemReveal {
  correct: boolean | null;
  expected: string | null;
  explain?: string;
}

/** Play / play-slowly buttons for a list of lines. */
export function SpeechButtons({
  lines,
  speech,
  id,
  label = 'Listen',
  size = 'sm',
}: {
  lines: CourseSpeech[];
  speech: CourseSpeechApi;
  id: string;
  label?: string;
  size?: 'sm' | 'default';
}) {
  const busy = speech.playing === id || speech.playing === `${id}:slow`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size={size} variant={busy ? 'secondary' : 'default'} onClick={() => (busy ? speech.stop() : void speech.play(lines, { id, gapMs: 350 }))}>
        {busy ? <Square className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
        {busy ? 'Stop' : label}
      </Button>
      <Button type="button" size={size} variant="outline" onClick={() => void speech.play(lines, { id: `${id}:slow`, rate: 0.75, gapMs: 500 })} title="Play slowly">
        <Snail className="mr-1.5 h-3.5 w-3.5" />
        Slowly
      </Button>
    </div>
  );
}

function RevealBox({ reveal }: { reveal: ItemReveal }) {
  if (reveal.correct === null) return reveal.explain ? <p className="text-sm text-muted-foreground">{reveal.explain}</p> : null;
  return (
    <div
      role="status"
      className={cn(
        'rounded-control border px-3 py-2 text-sm',
        reveal.correct ? 'border-status-online/40 bg-status-online/10' : 'border-destructive/40 bg-destructive/10',
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        {reveal.correct ? <Check className="h-4 w-4 text-status-online" /> : <X className="h-4 w-4 text-destructive" />}
        {reveal.correct ? 'Correct' : reveal.expected ? `Not quite — the answer is "${reveal.expected}"` : 'Not quite'}
      </p>
      {reveal.explain && <p className="mt-1 text-muted-foreground">{reveal.explain}</p>}
    </div>
  );
}

/**
 * One answerable item, any kind. Stateless: the player owns `value` (the
 * answer string the server grades — see CourseItem's doc comment for the
 * encoding per kind) and whether/what to reveal.
 */
export function CourseItemView({
  item,
  value,
  onChange,
  speech,
  control,
  attemptId,
  disabled,
  reveal,
  autoPlay,
}: {
  item: CourseItem;
  value: string | undefined;
  onChange: (value: string) => void;
  speech: CourseSpeechApi;
  control: StationControlClient;
  attemptId: string;
  disabled?: boolean;
  reveal?: ItemReveal | null;
  autoPlay?: boolean;
}) {
  const audio = 'audio' in item ? item.audio : undefined;
  const choices = item.kind === 'choice' || item.kind === 'multi' ? item.choices : null;
  // "Which word has a different stress pattern?" — one line per choice, so
  // each choice gets its own play button instead of one long listen.
  const perChoiceAudio = !!(audio && choices && audio.length > 1 && audio.every((l) => choices.includes(l.text)));

  useEffect(() => {
    if (autoPlay && audio && !perChoiceAudio && item.kind !== 'record') void speech.play(audio, { id: item.id, gapMs: 350 });
    // Once per item shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, autoPlay]);

  if (item.kind === 'record') {
    return <RecordItemView item={item} value={value} onChange={onChange} speech={speech} control={control} attemptId={attemptId} />;
  }

  if (item.kind === 'write') {
    return <WriteItemView item={item} value={value} onChange={onChange} disabled={disabled} />;
  }

  const selected = item.kind === 'multi' ? new Set(value ? value.split(MULTI_ANSWER_SEPARATOR) : []) : null;
  const correctChoices =
    reveal && reveal.expected !== null
      ? item.kind === 'multi'
        ? new Set(reveal.expected.split(', '))
        : new Set([reveal.expected])
      : null;

  return (
    <div className="space-y-4">
      {'prompt' in item && item.prompt && <p className="text-base font-medium">{item.prompt}</p>}
      {audio && !perChoiceAudio && <SpeechButtons lines={audio} speech={speech} id={item.id} />}

      {(item.kind === 'choice' || item.kind === 'multi') && (
        <div className={cn('grid gap-2', item.choices.length === 2 ? 'grid-cols-2' : 'sm:grid-cols-2')}>
          {item.choices.map((c) => {
            const isSelected = item.kind === 'multi' ? selected!.has(c) : value === c;
            const isRight = correctChoices?.has(c) ?? false;
            return (
              <div key={c} className="flex items-stretch gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (item.kind === 'multi') {
                      const next = new Set(selected);
                      if (next.has(c)) next.delete(c);
                      else next.add(c);
                      onChange(item.choices.filter((x) => next.has(x)).join(MULTI_ANSWER_SEPARATOR));
                    } else onChange(c);
                  }}
                  className={cn(
                    'flex-1 rounded-control border px-4 py-3 text-left text-base transition-colors',
                    'hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent',
                    isSelected && 'border-brand bg-brand/10 font-medium',
                    reveal && isRight && 'border-status-online bg-status-online/10',
                    reveal && isSelected && !isRight && 'border-destructive bg-destructive/10',
                  )}
                >
                  {item.kind === 'multi' && <span className="mr-2 inline-block w-4">{isSelected ? '☑' : '☐'}</span>}
                  {c}
                </button>
                {perChoiceAudio && (
                  <Button type="button" variant="outline" size="icon" title={`Hear "${c}"`} onClick={() => void speech.play([audio!.find((l) => l.text === c)!], { id: `${item.id}:${c}` })}>
                    <Play className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {item.kind === 'gap' && (
        <p className="flex flex-wrap items-center gap-2 text-lg leading-relaxed">
          {item.text.split('___').map((part, i, parts) => (
            <span key={i} className="contents">
              {part && <span>{part}</span>}
              {i < parts.length - 1 && (
                <Input
                  aria-label="Missing word"
                  className={cn(
                    'inline-flex h-9 w-40 text-base',
                    reveal?.correct === true && 'border-status-online',
                    reveal?.correct === false && 'border-destructive',
                  )}
                  value={value ?? ''}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => onChange(e.target.value)}
                />
              )}
            </span>
          ))}
        </p>
      )}

      {item.kind === 'stress' && (
        <div className="flex flex-wrap gap-1.5">
          {item.units.map((u, i) => {
            const isSelected = value === String(i);
            const revealAnswer = !!reveal && item.answer === i;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => onChange(String(i))}
                className={cn(
                  'min-w-[3rem] rounded-control border px-3 py-3 text-lg transition-colors hover:bg-accent disabled:hover:bg-transparent',
                  isSelected && 'border-brand bg-brand/10 font-semibold',
                  revealAnswer && 'border-status-online bg-status-online/10 font-bold uppercase',
                  reveal && isSelected && !revealAnswer && 'border-destructive bg-destructive/10',
                )}
              >
                {u}
              </button>
            );
          })}
        </div>
      )}

      {item.kind === 'field' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {item.label}
          <Input value={value ?? ''} disabled={disabled} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
        </label>
      )}

      {reveal && <RevealBox reveal={reveal} />}
    </div>
  );
}

/** A written answer with a live word count and what the task asks for. The
 * requirement chips are the same check the server applies on submit. */
function WriteItemView({
  item,
  value,
  onChange,
  disabled,
}: {
  item: Extract<CourseItem, { kind: 'write' }>;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const text = value ?? '';
  const req = writeRequirements(item, text);
  return (
    <div className="space-y-3">
      <p className="text-base font-medium leading-relaxed">{item.prompt}</p>
      <Textarea
        aria-label="Your writing"
        rows={10}
        value={text}
        disabled={disabled}
        spellCheck
        placeholder="Write here…"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={cn('font-medium', req.wordsOk ? 'text-status-online' : 'text-muted-foreground')}>
          {req.words} / {item.minWords} words{req.wordsOk ? ' ✓' : ''}
        </span>
        {req.needed > 0 && (
          <span className={cn('font-medium', req.usedOk ? 'text-status-online' : 'text-muted-foreground')}>
            Useful language used: {Math.min(req.used.length, req.needed)} / {req.needed}
            {req.usedOk ? ' ✓' : ''}
          </span>
        )}
      </div>
      {item.mustUse && item.mustUse.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Try to use at least {req.needed} of:{' '}
          {item.mustUse.map((p, i) => (
            <span key={p}>
              {i > 0 && ', '}
              <span className={cn(req.used.includes(p) && 'font-semibold text-status-online')}>{p}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Say it, record yourself, compare with the model; the take's Recording id
 * is the answer. Re-recording replaces it. */
function RecordItemView({
  item,
  value,
  onChange,
  speech,
  control,
  attemptId,
}: {
  item: Extract<CourseItem, { kind: 'record' }>;
  value: string | undefined;
  onChange: (value: string) => void;
  speech: CourseSpeechApi;
  control: StationControlClient;
  attemptId: string;
}) {
  const rec = useTakeRecorder(control, attemptId);
  useEffect(() => {
    if (rec.take) onChange(rec.take.recordingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.take?.recordingId]);

  return (
    <div className="space-y-3">
      <p className="text-lg font-medium leading-relaxed">{item.prompt}</p>
      <div className="flex flex-wrap items-center gap-2">
        {item.audio && <SpeechButtons lines={item.audio} speech={speech} id={item.id} label="Hear the model" />}
        {rec.isRecording ? (
          <Button type="button" variant="destructive" size="sm" disabled={rec.busy} onClick={() => void rec.stop()}>
            <Square className="mr-1.5 h-3.5 w-3.5" /> Stop recording
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={rec.busy} onClick={() => void rec.start()}>
            <Mic className="mr-1.5 h-3.5 w-3.5" /> {value ? 'Record again' : 'Record yourself'}
          </Button>
        )}
      </div>
      {rec.take?.playbackUrl && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Your recording (take {rec.take.index}) — compare it with the model:</p>
          <audio controls src={rec.take.playbackUrl} className="w-full" />
        </div>
      )}
      {rec.error && <p className="text-sm text-destructive">{rec.error}</p>}
    </div>
  );
}
