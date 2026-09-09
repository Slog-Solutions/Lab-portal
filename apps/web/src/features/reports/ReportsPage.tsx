import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exercisesApi } from '../../lib/exercises-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { useAuthStore } from '../../stores/auth-store';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    </div>
  );
}
