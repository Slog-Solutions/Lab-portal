import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityType, UserRole } from '@lab/shared';
import { exercisesApi } from '../../lib/exercises-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { usersApi } from '../../lib/users-api';
import { pronunciationApi } from '../../lib/pronunciation-api';
import { queryKeys } from '../../lib/query-keys';
import { kindByType } from '../assignments/assignment-kinds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function ExerciseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: exercise, isLoading } = useQuery({ queryKey: queryKeys.exercise(id!), queryFn: () => exercisesApi.get(id!) });
  const { data: students } = useQuery({ queryKey: ['users', 'STUDENT'], queryFn: () => usersApi.list(UserRole.STUDENT) });

  const [wordListText, setWordListText] = useState('');
  const [sampleSize, setSampleSize] = useState(5);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [targetScore, setTargetScore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pronStatus, setPronStatus] = useState<{ ipa: boolean; voice: boolean } | null>(null);

  const importText = useMutation({
    mutationFn: () => exercisesApi.importText(id!, wordListText, false),
    onSuccess: () => {
      setWordListText('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercise(id!) });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Import failed'),
  });

  const enableBank = useMutation({
    mutationFn: () =>
      exercisesApi.update(id!, { config: { itemBankId: exercise!.itemBank!.id, sampleSize, shuffleItems: true } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.exercise(id!) }),
  });

  const generatePronunciation = useMutation({
    mutationFn: () => {
      const cfg = exercise!.config as { sourceText: string; voice: 'en_US' | 'en_GB' };
      return pronunciationApi.generate(cfg.sourceText, cfg.voice);
    },
    onSuccess: async (res) => {
      const cfg = exercise!.config as { sourceText: string; voice: string };
      await exercisesApi.update(id!, {
        config: { ...cfg, ipaAssetId: res.ipaAssetId ?? undefined, modelAudioAssetId: res.modelAudioAssetId ?? undefined },
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercise(id!) });
      if (res.warnings.length) setError(res.warnings.join('; '));
    },
  });

  const assign = useMutation({
    mutationFn: () =>
      gradebookApi.createAssignments({
        studentIds: selectedStudents,
        exerciseIds: [id!],
        targetScore: targetScore ? Number(targetScore) : undefined,
      }),
    onSuccess: () => setSelectedStudents([]),
  });

  if (isLoading || !exercise) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const config = exercise.config as Record<string, unknown>;
  const isBankMode = Boolean(config.itemBankId);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/exercises" className="text-sm text-primary hover:underline">
          ← Exercises
        </Link>
        <h1 className="text-xl font-semibold">{exercise.title}</h1>
        <p className="text-sm text-muted-foreground">{exercise.type}</p>
      </div>

      {exercise.type === ActivityType.VOCABULARY_TEST && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Item Bank</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Answer</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exercise.itemBank?.items.map((item, i) => (
                  <TableRow key={item.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{item.prompt}</TableCell>
                    <TableCell>{item.answer}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="space-y-1.5">
              <Label>Import word list (one per line: prompt = answer, or prompt = answer | choice2 | choice3)</Label>
              <Textarea value={wordListText} onChange={(e) => setWordListText(e.target.value)} rows={5} placeholder="cat = chat&#10;dog = chien" />
              <Button size="sm" onClick={() => importText.mutate()} disabled={importText.isPending || !wordListText.trim()}>
                {importText.isPending ? 'Importing…' : 'Add items'}
              </Button>
            </div>

            {(exercise.itemBank?.items.length ?? 0) > 0 && (
              <div className="flex items-end gap-3 border-t border-border pt-3">
                <div className="space-y-1.5">
                  <Label>Sample size per attempt</Label>
                  <Input
                    type="number"
                    min={1}
                    value={sampleSize}
                    onChange={(e) => setSampleSize(Number(e.target.value))}
                    className="w-28"
                  />
                </div>
                <Button size="sm" variant={isBankMode ? 'secondary' : 'default'} onClick={() => enableBank.mutate()} disabled={enableBank.isPending}>
                  {isBankMode ? 'Update test-bank sampling' : 'Enable randomized test-bank sampling'}
                </Button>
                {isBankMode && <p className="text-xs text-muted-foreground">Currently sampling from the bank each attempt (Ser 10).</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {exercise.type === ActivityType.PRONUNCIATION && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pronunciation Assets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">Source text: {String(config.sourceText)}</p>
            <p className="text-xs text-muted-foreground">
              IPA asset: {String(config.ipaAssetId ?? 'not generated')} · Model audio: {String(config.modelAudioAssetId ?? 'not generated')}
            </p>
            <Button
              size="sm"
              onClick={() => {
                void pronunciationApi.status().then(setPronStatus);
                generatePronunciation.mutate();
              }}
              disabled={generatePronunciation.isPending}
            >
              {generatePronunciation.isPending ? 'Generating…' : 'Generate via offline pipeline'}
            </Button>
            {pronStatus && !pronStatus.ipa && !pronStatus.voice && (
              <p className="text-xs text-amber-500">
                eSpeak-NG/Piper aren't configured on this server — recording still works, just without generated IPA/model audio.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {exercise.type === ActivityType.PRONUNCIATION_TEST && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pronunciation Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Students record each word from their console; recordings and grading are on the test&apos;s results page.
            </p>
            <Link to={`/pronunciation-tests/${exercise.id}`} className="text-sm font-medium text-primary hover:underline">
              Open test results →
            </Link>
          </CardContent>
        </Card>
      )}

      {(() => {
        const isHandMarked = exercise.type === ActivityType.WRITING_TEST || exercise.type === ActivityType.READING_TEST;
        const assignmentKind =
          exercise.type === ActivityType.WRITING_TEST || exercise.type === ActivityType.LISTENING_TEST || exercise.type === ActivityType.READING_TEST
            ? kindByType(exercise.type)
            : undefined;
        if (!assignmentKind) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{assignmentKind.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Questions, students&apos; answers{isHandMarked ? ' and marking' : ''} are on the assignment&apos;s results page.
              </p>
              <Link to={`/assignments/${assignmentKind.slug}/${exercise.id}`} className="text-sm font-medium text-primary hover:underline">
                Open results →
              </Link>
            </CardContent>
          </Card>
        );
      })()}

      {exercise.type === ActivityType.CONTENT_EXERCISE && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content Package</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Package: {String(config.contentPackageId)}</p>
            <p className="text-sm">Grade level: {String(config.gradeLevel)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assign to Students</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {students?.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                <Checkbox
                  checked={selectedStudents.includes(s.id)}
                  onCheckedChange={(checked) =>
                    setSelectedStudents((prev) => (checked ? [...prev, s.id] : prev.filter((id_) => id_ !== s.id)))
                  }
                />
                {s.serviceNumber} — {s.fullName}
              </label>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Target score (%)</Label>
              <Input type="number" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} className="w-28" />
            </div>
            <Button onClick={() => assign.mutate()} disabled={assign.isPending || selectedStudents.length === 0}>
              {assign.isPending ? 'Assigning…' : `Assign to ${selectedStudents.length} student(s)`}
            </Button>
          </div>
          {assign.isSuccess && <p className="text-sm text-emerald-500">Assigned.</p>}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
