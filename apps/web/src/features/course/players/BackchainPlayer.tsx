import { useState } from 'react';
import { ChevronRight, Play } from 'lucide-react';
import { CourseItemView } from '../CourseItemView';
import type { PlayerProps } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Ser 10 "recording tool and back chaining facility". Each sentence is
 * built up from its end ("evening" → "on Friday evening" → ...): listen,
 * repeat aloud, add the next chunk. The last step records the whole
 * sentence, which is uploaded and compared with the model.
 */
export function BackchainPlayer({ activity, attemptId, answers, setAnswer, speech, control, submitting, onSubmit }: PlayerProps) {
  const sentences = activity.items.filter((i) => i.kind === 'record');
  const [index, setIndex] = useState(0);
  const [chunk, setChunk] = useState(0);
  const sentence = sentences[index];
  if (!sentence) return <p className="text-sm text-muted-foreground">No sentences in this set.</p>;

  const chunks = sentence.chunks ?? [sentence.prompt];
  const building = chunk < chunks.length;
  const done = sentences.filter((s) => answers[s.id]).length;
  const voice = sentence.audio?.[0]?.voice;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Sentence {index + 1} of {sentences.length}
        </span>
        <span>{done} recorded</span>
      </div>

      {building ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Step {chunk + 1} of {chunks.length}: listen, then say it aloud. Each step adds the part before it.
          </p>
          <ol className="space-y-1.5">
            {chunks.slice(0, chunk + 1).map((c, i) => (
              <li key={i} className={cn('rounded-control px-3 py-2 text-lg', i === chunk ? 'border border-brand bg-brand/10 font-medium' : 'text-muted-foreground')}>
                {c}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void speech.play([{ text: chunks[chunk]!, voice }], { id: `bc:${index}:${chunk}` })}>
              <Play className="mr-1.5 h-4 w-4" /> Listen
            </Button>
            <Button variant="outline" onClick={() => void speech.play([{ text: chunks[chunk]!, voice }], { id: `bc:${index}:${chunk}:slow`, rate: 0.75 })}>
              Slowly
            </Button>
            <Button onClick={() => setChunk(chunk + 1)}>
              {chunk === chunks.length - 1 ? 'Now record the whole sentence' : 'I said it — add the next part'}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <CourseItemView
            key={sentence.id}
            item={sentence}
            value={answers[sentence.id]}
            onChange={(v) => setAnswer(sentence.id, v)}
            speech={speech}
            control={control}
            attemptId={attemptId}
          />
          <Button variant="ghost" size="sm" onClick={() => setChunk(0)}>
            Practise the build-up again
          </Button>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2 border-t border-hairline pt-4">
        <Button
          variant="ghost"
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
            setChunk(0);
          }}
        >
          Previous sentence
        </Button>
        {index < sentences.length - 1 ? (
          <Button
            variant={answers[sentence.id] ? 'default' : 'outline'}
            onClick={() => {
              setIndex(index + 1);
              setChunk(0);
            }}
          >
            Next sentence
          </Button>
        ) : (
          <Button disabled={submitting || done === 0} onClick={() => onSubmit()}>
            {submitting ? 'Saving…' : `Finish (${done}/${sentences.length} recorded)`}
          </Button>
        )}
      </div>
    </div>
  );
}
