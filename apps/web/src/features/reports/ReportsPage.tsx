import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { exercisesApi } from '../../lib/exercises-api';
import { dictionaryReportsApi } from '../../lib/dictionary-reports-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { useAuthStore } from '../../stores/auth-store';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Ser 4 report tool export. A plain <a href> can't carry the bearer
 * token, so downloads go through an authenticated fetch -> blob -> a
 * synthetic click, same pattern as the media library's "Open" action. */
async function downloadReport(path: string, filename: string): Promise<void> {
  const { serverUrl } = getRuntimeConfig();
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${serverUrl}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Report generation failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ReportsPage() {
  const { data: exercises } = useQuery({ queryKey: queryKeys.exercises, queryFn: exercisesApi.list });
  const [exerciseId, setExerciseId] = useState('');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = exerciseId ? `?exerciseId=${exerciseId}` : '';

  async function download(kind: 'xlsx' | 'pdf'): Promise<void> {
    setBusy(kind);
    setError(null);
    try {
      await downloadReport(`/reports/attempts.${kind}${query}`, `attempts-report.${kind}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Export attempt results — every student, exercise, score and override.</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Attempts Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={exerciseId || 'all'} onValueChange={(v) => setExerciseId(v === 'all' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="All exercises" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All exercises</SelectItem>
              {exercises?.map((ex) => (
                <SelectItem key={ex.id} value={ex.id}>
                  {ex.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button onClick={() => void download('xlsx')} disabled={busy !== null}>
              {busy === 'xlsx' ? 'Generating…' : 'Download XLSX'}
            </Button>
            <Button variant="outline" onClick={() => void download('pdf')} disabled={busy !== null}>
              {busy === 'pdf' ? 'Generating…' : 'Download PDF'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <DictionaryLookupsReport />
    </div>
  );
}

/** Spec §8 (optional-but-built) — "words your class looked up most this
 * week" and one-click "add these to an item bank". Deliberately not
 * batch-scoped, same as the Attempts report above and Gradebook/Reports
 * generally (BatchAccessService's own doc comment: a student can be in
 * more than one batch, so scoping an aggregate like this through
 * Enrollment is ambiguous). Privacy note per spec §8: this is vocabulary
 * telemetry (which words, how often), not browsing history, retained for
 * a bounded period and purgeable by an admin. */
function DictionaryLookupsReport() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [exported, setExported] = useState<{ exerciseId: string; itemCount: number } | null>(null);

  const { data: words, isError } = useQuery({
    queryKey: queryKeys.dictionaryTopWords(days),
    queryFn: () => dictionaryReportsApi.topWords(days),
  });

  const exportMutation = useMutation({
    mutationFn: () => dictionaryReportsApi.exportToItemBank(title.trim(), Array.from(picked)),
    onSuccess: (result) => {
      setExported(result);
      setPicked(new Set());
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
    },
  });

  function togglePick(word: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">Dictionary Lookups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Vocabulary telemetry — which words your students looked up, and how often. Retained for a bounded period; an admin can
          purge it.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {words?.length === 0 && <p className="text-sm text-muted-foreground">No lookups in this period.</p>}
          {words?.map((row) => (
            <label key={row.word} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/50">
              <Checkbox checked={picked.has(row.word)} onCheckedChange={() => togglePick(row.word)} />
              <span className="flex-1">{row.word}</span>
              <span className="text-xs text-muted-foreground">{row.count}×</span>
            </label>
          ))}
          {isError && <p className="text-sm text-destructive">Could not load the dictionary report.</p>}
        </div>

        {picked.size > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label htmlFor="dict-export-title">New Vocabulary Test title</Label>
            <Input
              id="dict-export-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Words the class struggled with"
              maxLength={120}
            />
            <Button
              size="sm"
              disabled={!title.trim() || exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? 'Adding…' : `Add ${picked.size} word(s) to an item bank`}
            </Button>
            {exportMutation.isError && (
              <p className="text-sm text-destructive">
                {exportMutation.error instanceof Error ? exportMutation.error.message : 'Export failed'}
              </p>
            )}
          </div>
        )}

        {exported && (
          <p className="text-sm text-status-online">
            Created a Vocabulary Test with {exported.itemCount} word(s) — find it under Exercises.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
