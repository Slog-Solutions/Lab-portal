import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { exercisesApi } from '../../lib/exercises-api';
import { studyModulesApi } from '../../lib/study-modules-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/**
 * Ser 1 "content management library... self-study even when teacher not
 * present" / Ser 10 "CEFR-aligned worksheets across 4 key skills". A
 * StudyModule is a named, ordered bundle of already-authored exercises
 * (built on the Exercises page) — this page only curates which exercises
 * belong to which module; the exercises themselves keep their own
 * authoring flow (word-list import, item bank, pronunciation text, ...).
 */
export function StudyModulesPage() {
  const queryClient = useQueryClient();
  const { data: modules, isLoading } = useQuery({ queryKey: queryKeys.studyModules, queryFn: studyModulesApi.list });
  const { data: exercises } = useQuery({ queryKey: queryKeys.exercises, queryFn: exercisesApi.list });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => studyModulesApi.create({ title, exerciseIds: Array.from(selected) }),
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create study module'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => studyModulesApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules }),
  });

  function toggle(exerciseId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Study Library</h1>
          <p className="text-sm text-muted-foreground">
            Curated exercise bundles students can browse and practise from at any time — no session or teacher required.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New Study Module</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Study Module</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A2 Grammar Foundations" />
              </div>
              <div className="space-y-1.5">
                <Label>Exercises</Label>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {exercises?.map((ex) => (
                    <label key={ex.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                      <Checkbox checked={selected.has(ex.id)} onCheckedChange={() => toggle(ex.id)} />
                      <span className="flex-1">{ex.title}</span>
                      <Badge variant="outline">{ex.type}</Badge>
                    </label>
                  ))}
                  {exercises?.length === 0 && <p className="p-1.5 text-xs text-muted-foreground">No exercises authored yet — create one on the Exercises page first.</p>}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={() => create.mutate()} disabled={create.isPending || !title || selected.size === 0}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {modules?.map((mod) => (
            <Card key={mod.id}>
              <CardContent className="space-y-2 pt-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{mod.title}</p>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(mod.id)}>
                    Delete
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {mod.exercises.map((ex) => (
                    <Badge key={ex.id} variant="outline">
                      {ex.title}
                    </Badge>
                  ))}
                  {mod.exercises.length === 0 && <p className="text-xs text-muted-foreground">No exercises.</p>}
                </div>
              </CardContent>
            </Card>
          ))}
          {modules?.length === 0 && <p className="text-sm text-muted-foreground">No study modules yet.</p>}
        </div>
      )}
    </div>
  );
}
