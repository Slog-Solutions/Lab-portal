import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import {
  DEFAULT_TRANSLATION_ENGINE_PARAMS,
  TRANSLATION_LANGUAGES,
  type TranslationEngineParams,
  type TranslationSettings,
} from '@lab/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Panel } from '@/components/layout/Panel';
import { queryKeys } from '../../lib/query-keys';
import { translationApi } from '../../lib/translation-api';

/** Each knob, with the plain-language consequence of moving it. These
 * are latency/quality trade-offs an operator tunes against the Test tab's
 * measured numbers, so the hint says which direction does what. */
const PARAM_FIELDS: {
  key: keyof TranslationEngineParams;
  label: string;
  hint: string;
  step?: number;
}[] = [
  {
    key: 'sourceSegmentSizeMs',
    label: 'Source segment (ms)',
    hint: 'Audio consumed per model step. Lower = less lag but more GPU work per second of speech.',
  },
  {
    key: 'decisionThreshold',
    label: 'Decision threshold',
    hint: 'Confidence before the model commits to a word. Lower = faster but more re-phrasing.',
    step: 0.05,
  },
  {
    key: 'minStartingWaitMs',
    label: 'Starting wait (ms)',
    hint: 'Audio heard before anything is emitted. Raising it helps word order in languages that need it.',
  },
  {
    key: 'catchUpStartMs',
    label: 'Catch-up starts at (ms)',
    hint: 'Playout backlog at which translated speech starts speeding up to catch the teacher.',
  },
  {
    key: 'maxCatchUpRate',
    label: 'Max catch-up rate',
    hint: '1.15 = plays up to 15% faster (pitch preserved). Too high sounds rushed.',
    step: 0.05,
  },
  {
    key: 'dropBacklogMs',
    label: 'Drop backlog at (ms)',
    hint: 'Backlog at which playout skips ahead to the next segment rather than falling further behind.',
  },
];

/**
 * Admin-only: which languages students may choose, how many GPU streams
 * the lab will run at once, and the engine's latency/quality knobs.
 *
 * Saves are all-or-nothing against one AppSetting row, so the form holds
 * a draft and the server re-validates it — an operator cannot leave the
 * engine half-configured partway through an edit.
 */
export function TranslationSettingsTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TranslationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const settings = useQuery({ queryKey: queryKeys.translationSettings, queryFn: translationApi.getSettings });
  const health = useQuery({
    queryKey: queryKeys.translationHealth,
    queryFn: translationApi.health,
    // The engine's VRAM and stream count move while classes run; this is
    // the page an operator watches when something is wrong.
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (next: TranslationSettings) => translationApi.putSettings(next),
    onSuccess: (result) => {
      setError(null);
      setSaved(true);
      setDraft(result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.translationLanguages });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!draft) {
    return (
      <Panel>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading settings" />
      </Panel>
    );
  }

  const engine = health.data?.engine;

  return (
    <div className="space-y-4">
      <Panel title="Engine">
        {!health.data?.configured ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <code>TRANSLATOR_URL</code> is not set, so live translation is disabled server-wide. Settings below are still
              saved and take effect once a translator is reachable.
            </span>
          </p>
        ) : (
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Stat label="Reachable" value={engine?.reachable ? 'yes' : 'no'} bad={!engine?.reachable} />
            <Stat label="GPU" value={engine?.gpu ? (engine.device ?? 'yes') : 'CPU only'} bad={!engine?.gpu} />
            <Stat label="Model" value={engine?.modelLoaded ? 'loaded' : 'not loaded'} bad={engine?.modelLoaded === false} />
            <Stat
              label="VRAM"
              value={
                engine?.vramUsedMb !== undefined && engine?.vramTotalMb !== undefined
                  ? `${Math.round(engine.vramUsedMb)} / ${Math.round(engine.vramTotalMb)} MB`
                  : '—'
              }
            />
            <Stat
              label="Streams"
              value={engine?.activeStreams !== undefined ? `${engine.activeStreams} / ${engine.maxStreams ?? '?'}` : '—'}
            />
          </dl>
        )}
        {engine?.detail && <p className="mt-2 text-xs text-muted-foreground">{engine.detail}</p>}
      </Panel>

      <Panel
        title="Languages students can choose"
        description={
          'Every enabled language is one a student may select mid-class, which may start a GPU stream. Languages marked ' +
          '"captions only" cost less — Seamless can translate into them as text but cannot synthesise speech.'
        }
      >
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {TRANSLATION_LANGUAGES.map((lang) => {
            const checked = draft.enabledLanguages.includes(lang.code);
            return (
              <label key={lang.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            enabledLanguages: next
                              ? [...prev.enabledLanguages, lang.code]
                              : prev.enabledLanguages.filter((c) => c !== lang.code),
                          }
                        : prev,
                    )
                  }
                />
                <span className="truncate">
                  {lang.name}
                  {lang.nativeName !== lang.name && <span className="text-muted-foreground"> · {lang.nativeName}</span>}
                </span>
                {!lang.speech && <span className="shrink-0 text-xs text-muted-foreground">captions</span>}
              </label>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Engine tuning"
        description="Tune these against the Test tab's measured lag, not by feel — then re-run the same clip to compare."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="max-streams">
              Max concurrent streams
            </label>
            <Input
              id="max-streams"
              type="number"
              min={1}
              max={16}
              value={draft.maxStreams}
              onChange={(e) =>
                setDraft((prev) => (prev ? { ...prev, maxStreams: Number(e.target.value) } : prev))
              }
            />
            <p className="text-xs text-muted-foreground">
              Across all classes. Beyond this, the least-listened language is dropped.
            </p>
          </div>
          {PARAM_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`param-${field.key}`}>
                {field.label}
              </label>
              <Input
                id={`param-${field.key}`}
                type="number"
                step={field.step ?? 1}
                value={draft.engineParams[field.key]}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, engineParams: { ...prev.engineParams, [field.key]: Number(e.target.value) } } : prev,
                  )
                }
              />
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft((prev) => (prev ? { ...prev, engineParams: { ...DEFAULT_TRANSLATION_ENGINE_PARAMS } } : prev))}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Reset tuning to defaults
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        {error && <span className="text-sm text-status-pending">{error}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={bad ? 'font-medium text-status-pending' : 'font-medium'}>{value}</dd>
    </div>
  );
}
