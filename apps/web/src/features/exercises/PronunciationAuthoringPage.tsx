import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityType } from '@lab/shared';
import { Mic, Volume2, Sparkles, RotateCcw, CheckCircle2, AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { exercisesApi } from '../../lib/exercises-api';
import { pronunciationApi } from '../../lib/pronunciation-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PronunciationConfig {
  sourceText: string;
  voice: 'en_US' | 'en_GB';
  ipaAssetId?: string;
  modelAudioAssetId?: string;
}

/** Ser 7 "Pronunciation Activity" — teacher authoring side.
 * Turns any text into a pronunciation exercise: generates IPA + model
 * audio via the offline eSpeak-NG/Piper pipeline and lets the teacher
 * preview both before saving. The student-side player (PronunciationPlayer)
 * reads these exact config fields at runtime. */
export function PronunciationAuthoringPage() {
  const queryClient = useQueryClient();

  // ── Pipeline status ──────────────────────────────────────────────────
  const { data: pipelineStatus } = useQuery({
    queryKey: queryKeys.pronunciationStatus,
    queryFn: pronunciationApi.status,
    staleTime: 60_000,
  });

  // ── Authoring state ───────────────────────────────────────────────────
  const [sourceText, setSourceText] = useState('');
  const [voice, setVoice] = useState<'en_US' | 'en_GB'>('en_GB');
  const [ipaText, setIpaText] = useState<string | null>(null);
  const [modelAudioUrl, setModelAudioUrl] = useState<string | null>(null);
  const [generatedAssets, setGeneratedAssets] = useState<{
    ipaAssetId?: string;
    modelAudioAssetId?: string;
  } | null>(null);
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const audioRef = useRef<string | null>(null);

  // ── Save-as-exercise state ────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Revoke blob URL on unmount / regeneration
  useEffect(() => {
    return () => {
      if (audioRef.current) URL.revokeObjectURL(audioRef.current);
    };
  }, []);

  // ── Existing pronunciation exercises list ─────────────────────────────
  const { data: allExercises } = useQuery({
    queryKey: queryKeys.exercises,
    queryFn: exercisesApi.list,
  });
  const pronunciationExercises = allExercises?.filter((ex) => ex.type === ActivityType.PRONUNCIATION) ?? [];

  // ── Generate IPA + model audio ────────────────────────────────────────
  const generate = useMutation({
    mutationFn: () => pronunciationApi.generate(sourceText.trim(), voice),
    onSuccess: async (res) => {
      setGeneratedAssets({ ipaAssetId: res.ipaAssetId ?? undefined, modelAudioAssetId: res.modelAudioAssetId ?? undefined });
      setGenerateWarnings(res.warnings);

      // Fetch IPA text if asset was created
      if (res.ipaAssetId) {
        try {
          const text = await gradebookApi.fetchMediaAssetText(res.ipaAssetId);
          setIpaText(text.trim());
        } catch {
          setIpaText(null);
        }
      } else {
        setIpaText(null);
      }

      // Fetch model audio blob for preview playback
      if (audioRef.current) URL.revokeObjectURL(audioRef.current);
      if (res.modelAudioAssetId) {
        try {
          const url = await gradebookApi.fetchMediaAssetBlob(res.modelAudioAssetId);
          audioRef.current = url;
          setModelAudioUrl(url);
        } catch {
          setModelAudioUrl(null);
        }
      } else {
        setModelAudioUrl(null);
      }
    },
  });

  // ── Save exercise ─────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () =>
      exercisesApi.create({
        type: ActivityType.PRONUNCIATION,
        title: title.trim(),
        config: {
          sourceText: sourceText.trim(),
          voice,
          ipaAssetId: generatedAssets?.ipaAssetId,
          modelAudioAssetId: generatedAssets?.modelAudioAssetId,
        } satisfies PronunciationConfig,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
      setSaveSuccess(true);
      setTitle('');
      setSourceText('');
      setIpaText(null);
      setModelAudioUrl(null);
      setGeneratedAssets(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : 'Save failed'),
  });

  const canGenerate = sourceText.trim().length > 0;
  const canSave = Boolean(title.trim()) && Boolean(generatedAssets);

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Mic className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pronunciation Activity</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Annexure-I Ser 7 — turn any text into a listen-and-repeat exercise with model pronunciation and IPA transcription.
        </p>
      </div>

      {/* ── Pipeline status banner ────────────────────────────────────── */}
      {pipelineStatus && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            pipelineStatus.ipa && pipelineStatus.voice
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}
        >
          {pipelineStatus.ipa && pipelineStatus.voice ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <span className="font-medium">Offline speech pipeline: </span>
            {pipelineStatus.ipa && pipelineStatus.voice
              ? 'eSpeak-NG (IPA) and Piper (model voice) are both available.'
              : `${!pipelineStatus.ipa ? 'eSpeak-NG (IPA) not configured. ' : ''}${!pipelineStatus.voice ? 'Piper (model voice) not configured.' : ''} Recording and self-assessment still work without the pipeline.`}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Left: Authoring workspace ─────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Text</CardTitle>
              <CardDescription>
                The text students will listen to and repeat. Aim for 10–60 words for best results.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="source-text">Text</Label>
                  <span className="text-xs text-muted-foreground">{sourceText.length}/2000</span>
                </div>
                <Textarea
                  id="source-text"
                  value={sourceText}
                  onChange={(e) => {
                    setSourceText(e.target.value);
                    // Reset generated assets if text changes
                    if (generatedAssets) {
                      setGeneratedAssets(null);
                      setIpaText(null);
                      setModelAudioUrl(null);
                    }
                  }}
                  placeholder="The quick brown fox jumps over the lazy dog."
                  rows={5}
                  maxLength={2000}
                  className="resize-none font-medium text-base leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="voice-select">Model Voice</Label>
                <Select value={voice} onValueChange={(v) => setVoice(v as 'en_US' | 'en_GB')}>
                  <SelectTrigger id="voice-select" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en_GB">🇬🇧 en_GB (British)</SelectItem>
                    <SelectItem value="en_US">🇺🇸 en_US (American)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => generate.mutate()}
                disabled={generate.isPending || !canGenerate}
                className="w-full gap-2"
              >
                {generate.isPending ? (
                  <>
                    <RotateCcw className="h-4 w-4 animate-spin" />
                    Generating IPA + Model Audio…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate IPA + Model Audio
                  </>
                )}
              </Button>

              {generateWarnings.length > 0 && (
                <div className="rounded-md border border-amber-400/30 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  {generateWarnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Generated preview ──────────────────────────────────── */}
          {generatedAssets && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Generated Assets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ipaText ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">IPA Transcription</p>
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <p className="font-mono text-sm leading-relaxed">{ipaText}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">IPA not generated (eSpeak-NG not configured).</p>
                )}

                {modelAudioUrl ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model Audio ({voice})</p>
                    </div>
                    <audio controls src={modelAudioUrl} className="w-full h-10" />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Model audio not generated (Piper not configured).</p>
                )}

                {/* Save as exercise */}
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-sm font-medium">Save as Exercise</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="exercise-title">Exercise Title</Label>
                    <Input
                      id="exercise-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder='e.g. "Unit 3 — Daily Routines pronunciation drill"'
                    />
                  </div>
                  {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                  {saveSuccess && (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" /> Exercise saved successfully!
                    </p>
                  )}
                  <Button
                    onClick={() => save.mutate()}
                    disabled={save.isPending || !canSave}
                    className="w-full gap-2"
                    variant="default"
                  >
                    <Plus className="h-4 w-4" />
                    {save.isPending ? 'Saving…' : 'Save Exercise'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right: Existing exercises table ───────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your Pronunciation Exercises</CardTitle>
              <CardDescription>Click an exercise to assign it or review student attempts.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {pronunciationExercises.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Mic className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No pronunciation exercises yet.</p>
                  <p className="text-xs text-muted-foreground">Generate text and model audio on the left, then save.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Voice</TableHead>
                      <TableHead>IPA</TableHead>
                      <TableHead>Audio</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pronunciationExercises.map((ex) => {
                      const cfg = ex.config as Partial<PronunciationConfig>;
                      return (
                        <TableRow key={ex.id} className="group">
                          <TableCell className="font-medium">{ex.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {cfg.voice ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {cfg.ipaAssetId ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {cfg.modelAudioAssetId ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link
                              to={`/pronunciation/${ex.id}/review`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              Review
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
