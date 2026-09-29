import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { VocabQuestionInput } from '../../lib/assessments-api';
import { parseQuestionList } from './question-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

/**
 * SPEC-mcq-test-timed-reveal.md §7.1 "Import path: keep the existing
 * word-list import... as a fast way to seed a form, then edit in the
 * builder." Replaces (not appends to) the builder's question list — a
 * teacher pasting a list is starting over, not merging by hand.
 */
export function ImportQuestionsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (questions: VocabQuestionInput[]) => void;
}) {
  const [text, setText] = useState('');
  const { questions, warnings } = parseQuestionList(text);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from a word list</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'cat = gato\ndog = perro | gato | pez'}
            className="resize-none font-mono text-sm"
          />
          <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {'big = large                → the student types the answer\nbig = large | small | red  → multiple choice (the first one is correct)'}
          </pre>
          {questions.length > 0 && <p className="text-xs text-muted-foreground">{questions.length} question{questions.length === 1 ? '' : 's'} ready to import.</p>}
          {warnings.length > 0 && (
            <div className="space-y-0.5 rounded-md border border-amber-600/40 bg-amber-950/20 p-2 text-xs text-amber-500">
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">This replaces the questions already in the builder below — edit them there afterwards.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={questions.length === 0}
            className="gap-1.5"
            onClick={() => {
              onImport(questions);
              setText('');
              onOpenChange(false);
            }}
          >
            <Upload className="h-4 w-4" />
            Import {questions.length > 0 ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
