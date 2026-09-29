import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2, X } from 'lucide-react';
import type { VocabQuestionInput } from '../../lib/assessments-api';
import type { MediaAsset } from '../../lib/media-assets-api';
import { AudioPicker } from './AudioPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Per-card validation (§7.1: "question non-empty, ≥2 options, all options
 * non-empty and distinct, exactly one marked correct"). The server enforces
 * the same rule (zVocabQuestionInput's superRefine) — this is feedback, not
 * the actual gate. */
export function validateQuestion(q: VocabQuestionInput): string[] {
  const errors: string[] = [];
  if (!q.prompt.trim()) errors.push('Question text is required');
  if (q.options.length < 2) errors.push('At least 2 options are needed');
  if (q.options.some((o) => !o.trim())) errors.push('Every option needs text');
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const o of q.options) {
    const key = o.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) hasDuplicate = true;
    seen.add(key);
  }
  if (hasDuplicate) errors.push('Options must be distinct');
  if (q.correctIndex < 0 || q.correctIndex >= q.options.length) errors.push('Mark which option is correct');
  return errors;
}

/**
 * SPEC-mcq-test-timed-reveal.md §7.1 — the Google-Forms-style question
 * builder: a vertical list of cards, each with a prompt, 2-6 option rows
 * with a radio marking the correct one, an optional explanation, optional
 * audio, and duplicate/delete/reorder. Drag reorder is native HTML5 drag
 * (no dnd-kit/react-beautiful-dnd in this repo) plus ▲/▼ buttons for
 * keyboard/no-drag use.
 *
 * Media is audio-only (not image) — VocabularyTestPlayer's ItemAudio only
 * renders `<audio>`; wiring an image viewer into the student player is out
 * of scope for this pass. `mediaCache` only holds assets picked THIS
 * session (a fresh upload/library pick) so AudioPicker can show its normal
 * "already chosen" summary; a question loaded from a saved test with a
 * pre-existing mediaAssetId just shows the picker itself until the teacher
 * touches it — a minor, deliberate rough edge, not a correctness gap
 * (mediaAssetId itself round-trips correctly either way).
 */
export function VocabularyTestBuilder({
  questions,
  onChange,
}: {
  questions: VocabQuestionInput[];
  onChange: (next: VocabQuestionInput[]) => void;
}) {
  const [mediaCache, setMediaCache] = useState<Record<number, MediaAsset>>({});
  const dragIndexRef = useRef<number | null>(null);

  function update(i: number, patch: Partial<VocabQuestionInput>): void {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function updateOption(i: number, optIdx: number, value: string): void {
    const q = questions[i]!;
    update(i, { options: q.options.map((o, oi) => (oi === optIdx ? value : o)) });
  }

  function addOption(i: number): void {
    const q = questions[i]!;
    if (q.options.length >= 6) return;
    update(i, { options: [...q.options, ''] });
  }

  function removeOption(i: number, optIdx: number): void {
    const q = questions[i]!;
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, oi) => oi !== optIdx);
    const correctIndex = optIdx === q.correctIndex ? 0 : optIdx < q.correctIndex ? q.correctIndex - 1 : q.correctIndex;
    update(i, { options, correctIndex });
  }

  function addQuestion(): void {
    onChange([...questions, { prompt: '', options: ['', ''], correctIndex: 0 }]);
  }

  function duplicateQuestion(i: number): void {
    const q = questions[i]!;
    onChange([...questions.slice(0, i + 1), { ...q, options: [...q.options] }, ...questions.slice(i + 1)]);
  }

  function deleteQuestion(i: number): void {
    onChange(questions.filter((_, idx) => idx !== i));
    setMediaCache((prev) => {
      const next: Record<number, MediaAsset> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      });
      return next;
    });
  }

  function move(i: number, to: number): void {
    if (to < 0 || to >= questions.length || to === i) return;
    const next = [...questions];
    const [moved] = next.splice(i, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No questions yet — add one below.
        </p>
      )}
      {questions.map((q, i) => {
        const errors = validateQuestion(q);
        return (
          <div
            key={i}
            draggable
            onDragStart={() => {
              dragIndexRef.current = i;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = dragIndexRef.current;
              dragIndexRef.current = null;
              if (from !== null) move(from, i);
            }}
            className="space-y-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start gap-2">
              <GripVertical className="mt-7 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`vq-${i}-prompt`}>Question {i + 1}</Label>
                <Input
                  id={`vq-${i}-prompt`}
                  value={q.prompt}
                  onChange={(e) => update(i, { prompt: e.target.value })}
                  placeholder="e.g. What is the capital of France?"
                  maxLength={500}
                />
              </div>
              <div className="mt-6 flex shrink-0 items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" title="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" title="Move down" onClick={() => move(i, i + 1)} disabled={i === questions.length - 1}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" title="Duplicate" onClick={() => duplicateQuestion(i)}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" title="Delete" onClick={() => deleteQuestion(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 pl-6">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`vq-${i}-correct`}
                    checked={q.correctIndex === oi}
                    onChange={() => update(i, { correctIndex: oi })}
                    aria-label={`Option ${oi + 1} is correct`}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <Input value={opt} onChange={(e) => updateOption(i, oi, e.target.value)} placeholder={`Option ${oi + 1}`} maxLength={200} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(i, oi)}
                    disabled={q.options.length <= 2}
                    title="Remove option"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {q.options.length < 6 && (
                <Button type="button" variant="outline" size="sm" onClick={() => addOption(i)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add option
                </Button>
              )}
            </div>

            <div className="space-y-1.5 pl-6">
              <Label htmlFor={`vq-${i}-explanation`}>Explanation (optional — shown on the results screen after reveal)</Label>
              <Textarea
                id={`vq-${i}-explanation`}
                value={q.explanation ?? ''}
                onChange={(e) => update(i, { explanation: e.target.value || undefined })}
                rows={2}
                maxLength={500}
                className="resize-none"
                placeholder="Why this is the right answer"
              />
            </div>

            <div className="space-y-1.5 pl-6">
              <Label>Audio (optional)</Label>
              <AudioPicker
                value={mediaCache[i] ?? null}
                onChange={(asset) => {
                  update(i, { mediaAssetId: asset?.id });
                  setMediaCache((prev) => {
                    const next = { ...prev };
                    if (asset) next[i] = asset;
                    else delete next[i];
                    return next;
                  });
                }}
              />
              {q.mediaAssetId && !mediaCache[i] && <p className="text-xs text-muted-foreground">Audio already attached — pick a file to change it.</p>}
            </div>

            {errors.length > 0 && <p className="pl-6 text-xs text-destructive">{errors.join(' · ')}</p>}
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={addQuestion} className="w-full gap-1.5">
        <Plus className="h-4 w-4" /> Add question
      </Button>
    </div>
  );
}
