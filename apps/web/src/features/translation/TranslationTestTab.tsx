import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { findTranslationLanguage, translationLanguageLabel, type TranslationTestMode } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Panel } from '@/components/layout/Panel';
import { queryKeys } from '../../lib/query-keys';
import { translationApi, type TranslationTestRun } from '../../lib/translation-api';
import { TestRunMonitor } from './TestRunMonitor';

/** While a run is in flight the page polls; `realtime` runs take as long
 * as the clip itself, so this is the responsiveness the teacher sees on
 * the status line. */
const POLL_MS = 1500;

/**
 * Upload an audio file and watch the live pipeline translate it.
 *
 * `realtime` is the default because it is the only mode whose latency
 * numbers mean anything: the file is paced at 1x through a real LiveKit
 * room and auditioned with the same listener the students use, so what
 * the teacher hears here is what a student hears in class. `fast` exists
 * for judging translation QUALITY without sitting through the clip.
 */
export function TranslationTestTab() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<TranslationTestMode>('realtime');
  const [sourceLanguage, setSourceLanguage] = useState('eng');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveRoom, setLiveRoom] = useState<{ room: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const languages = useQuery({ queryKey: queryKeys.translationLanguages, queryFn: translationApi.languages });
  const runs = useQuery({ queryKey: queryKeys.translationTestRuns, queryFn: () => translationApi.listTestRuns(15) });

  const activeRun = useQuery({
    queryKey: queryKeys.translationTestRun(activeRunId ?? 'none'),
    queryFn: () => translationApi.getTestRun(activeRunId!),
    enabled: activeRunId !== null,
    // Stops polling the moment the run settles, so an idle page makes no
    // requests at all.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? POLL_MS : false;
    },
  });

  // A finished run refreshes the history list once, rather than the list
  // polling on its own schedule.
  const finishedStatus = activeRun.data?.status;
  useEffect(() => {
    if (finishedStatus === 'done' || finishedStatus === 'failed') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationTestRuns });
    }
  }, [finishedStatus, queryClient]);

  const start = useMutation({
    mutationFn: () =>
      translationApi.createTestRun({ file: file!, langs: selected, mode, sourceLanguage }),
    onSuccess: (res) => {
      setError(null);
      setActiveRunId(res.runId);
      setLiveRoom(res.room && res.token ? { room: res.room, token: res.token } : null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationTestRuns });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (runId: string) => translationApi.deleteTestRun(runId),
    onSuccess: (_res, runId) => {
      if (runId === activeRunId) {
        setActiveRunId(null);
        setLiveRoom(null);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationTestRuns });
    },
  });

  if (languages.data && !languages.data.configured) {
    return (
      <Panel>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            No translation service is configured on this server (<code>TRANSLATOR_URL</code> is unset). Live translation and
            this test page stay unavailable until one is reachable — see <code>services/translator/README.md</code>.
          </span>
        </p>
      </Panel>
    );
  }

  const enabled = languages.data?.enabled ?? [];
  const canStart = file !== null && selected.length > 0 && !start.isPending;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="translation-test-file">
              Audio file
            </label>
            <Input
              id="translation-test-file"
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Any audio (or a video's audio track). Speech with natural pauses gives the most representative latency.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="translation-test-source">
                Spoken in
              </label>
              <NativeSelect
                id="translation-test-source"
                className="w-44"
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
              >
                {(languages.data?.catalog ?? []).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="translation-test-mode">
                Mode
              </label>
              <NativeSelect
                id="translation-test-mode"
                className="w-64"
                value={mode}
                onChange={(e) => setMode(e.target.value as TranslationTestMode)}
              >
                <option value="realtime">Real time — as students hear it</option>
                <option value="fast">Fast — quality only, no timing</option>
              </NativeSelect>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Translate into</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {enabled
                .filter((code) => code !== sourceLanguage)
                .map((code) => {
                  const lang = findTranslationLanguage(code);
                  const checked = selected.includes(code);
                  return (
                    <label key={code} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        // Four is the cap the DTO enforces: each language
                        // is a concurrent GPU stream.
                        disabled={!checked && selected.length >= 4}
                        onCheckedChange={(next) =>
                          setSelected((prev) => (next ? [...prev, code] : prev.filter((c) => c !== code)))
                        }
                      />
                      {translationLanguageLabel(code)}
                      {lang && !lang.speech && <span className="text-xs text-muted-foreground">(captions only)</span>}
                    </label>
                  );
                })}
            </div>
            <p className="text-xs text-muted-foreground">Up to 4 at once — each one is a separate GPU stream.</p>
          </fieldset>

          <div className="flex items-center gap-3">
            <Button type="button" disabled={!canStart} onClick={() => start.mutate()}>
              {start.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Run test
            </Button>
            {error && <p className="text-sm text-status-pending">{error}</p>}
          </div>
        </div>
      </Panel>

      {activeRunId && activeRun.data && (
        <TestRunMonitor run={activeRun.data} liveRoom={liveRoom} />
      )}

      <Panel title="Recent runs">
        {runs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (runs.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No test runs yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {runs.data!.map((run) => (
              <li key={run.id} className="flex items-center gap-3 py-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => {
                    setActiveRunId(run.id);
                    // A past run has no live room to audition; its saved
                    // output files are played from disk instead.
                    setLiveRoom(null);
                  }}
                >
                  <span className="font-medium">{run.fileName}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {run.langs.map(translationLanguageLabel).join(', ')} · {run.mode}
                  </span>
                </button>
                <RunStatusBadge run={run} />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete run of ${run.fileName}`}
                  onClick={() => remove.mutate(run.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RunStatusBadge({ run }: { run: TranslationTestRun }) {
  if (run.status === 'running' || run.status === 'queued') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {run.status}
      </span>
    );
  }
  if (run.status === 'failed') {
    return (
      <span className="shrink-0 text-xs text-status-pending" title={run.error ?? undefined}>
        failed
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-muted-foreground">done</span>;
}
