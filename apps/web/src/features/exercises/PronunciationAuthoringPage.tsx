import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRONUNCIATION_TEXT_MAX_LENGTH, UserRole } from '@lab/shared';
import { Mic, CheckCircle2, AlertTriangle, ChevronRight, Send } from 'lucide-react';
import { pronunciationApi, type PronunciationVoice } from '../../lib/pronunciation-api';
import { batchesApi } from '../../lib/batches-api';
import { usersApi, type UserRow } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from './StudentPicker';
import { AssignPronunciationDialog } from './AssignPronunciationDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix &lt;Select&gt; reserves value="" for "cleared". */
const ALL_STUDENTS = '__all__';

/** Ser 7 "Pronunciation Activity" — teacher authoring side. One step: a
 * sentence, paragraph or single word, the students, and a due date —
 * "Create & send" does both at once (PronunciationService.createExercise),
 * the same shape as the Vocabulary/Writing/Listening Test forms. IPA and
 * model audio are never generated here; they're synthesized on demand —
 * by the student's "Listen to pronunciation" button and by this page's own
 * Review screen — so creating an exercise is never gated on the offline
 * speech pipeline being reachable. */
export function PronunciationAuthoringPage() {
  const queryClient = useQueryClient();

  const { data: pipelineStatus } = useQuery({
    queryKey: queryKeys.pronunciationStatus,
    queryFn: pronunciationApi.status,
    staleTime: 60_000,
  });

  const { data: pronunciationExercises } = useQuery({
    queryKey: queryKeys.pronunciationExercises,
    queryFn: pronunciationApi.exercises.list,
  });

  // ── New exercise form ─────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [voice, setVoice] = useState<PronunciationVoice>('en_GB');
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [autoSelected, setAutoSelected] = useState(false);
  const [created, setCreated] = useState<{ exerciseId: string; assigned: number } | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; title: string } | null>(null);

  const { data: myClasses } = useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine });
  const { data: allStudents } = useQuery({
    queryKey: queryKeys.users(UserRole.STUDENT),
    queryFn: () => usersApi.list(UserRole.STUDENT),
    enabled: !classId,
  });
  const { data: classStudents, isLoading: classStudentsLoading } = useQuery({
    queryKey: queryKeys.classStudents(classId),
    queryFn: () => batchesApi.listStudents(classId),
    enabled: Boolean(classId),
  });

  const classStudentRows: UserRow[] = (classStudents ?? [])
    .filter((s) => s.user.active)
    .map((s) => ({ id: s.userId, serviceNumber: s.user.serviceNumber, fullName: s.user.fullName, role: 'STUDENT' as const, rank: null, active: true }));
  const activeStudents = classId ? classStudentRows : (allStudents ?? []).filter((s) => s.active);

  // Auto-select everyone in the chosen class, once — same pattern as
  // CreateAssignmentPage's ?classId flow.
  useEffect(() => {
    if (classId && classStudentRows.length > 0 && !autoSelected) {
      setSelected(classStudentRows.map((s) => s.id));
      setAutoSelected(true);
    }
  }, [classId, classStudentRows.length, autoSelected]);

  const create = useMutation({
    mutationFn: () =>
      pronunciationApi.exercises.create({
        title: title.trim(),
        sourceText: sourceText.trim(),
        voice,
        studentIds: selected,
        batchId: classId || undefined,
        dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationExercises });
      setCreated(res);
      setTitle('');
      setSourceText('');
      setSelected([]);
      setDueDate('');
      setClassId('');
      setAutoSelected(false);
    },
  });

  const canCreate = Boolean(title.trim()) && Boolean(sourceText.trim()) && selected.length > 0;

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Mic className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pronunciation Activity</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Annexure-I Ser 7 — give students a sentence, paragraph or word to record themselves saying; you listen and score their pronunciation.
        </p>
      </div>

      {/* ── Pipeline status banner ────────────────────────────────────── */}
      {pipelineStatus && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            pipelineStatus.ipa && pipelineStatus.voice
              ? 'border-emerald-500/30 bg-emerald-500/10 text-status-online'
              : 'border-amber-500/30 bg-amber-500/10 text-status-pending'
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
              ? 'eSpeak-NG (IPA) and Piper (model voice) are both available — students can hear a model reading before they record.'
              : `${!pipelineStatus.ipa ? 'eSpeak-NG (IPA) not configured. ' : ''}${!pipelineStatus.voice ? 'Piper (model voice) not configured.' : ''} Recording still works without the pipeline — students just won't hear a model voice.`}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New pronunciation exercise</CardTitle>
            <CardDescription>Students see it under My Assignments within about 30 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pe-title">Title</Label>
              <Input id="pe-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder='e.g. "Unit 3 — daily routines"' maxLength={200} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="pe-text">Text (a sentence, paragraph or word)</Label>
                <span className="text-xs text-muted-foreground">
                  {sourceText.length}/{PRONUNCIATION_TEXT_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="pe-text"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="The quick brown fox jumps over the lazy dog."
                rows={5}
                maxLength={PRONUNCIATION_TEXT_MAX_LENGTH}
                className="resize-none text-base leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pe-voice">Model voice</Label>
              <Select value={voice} onValueChange={(v) => setVoice(v as PronunciationVoice)}>
                <SelectTrigger id="pe-voice" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en_GB">🇬🇧 en_GB (British)</SelectItem>
                  <SelectItem value="en_US">🇺🇸 en_US (American)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pe-class">Class (optional)</Label>
              <Select
                value={classId || ALL_STUDENTS}
                onValueChange={(v) => {
                  setClassId(v === ALL_STUDENTS ? '' : v);
                  setSelected([]);
                  setAutoSelected(false);
                }}
              >
                <SelectTrigger id="pe-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STUDENTS}>All students</SelectItem>
                  {(myClasses ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.studentCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {classId && classStudentsLoading && <p className="text-xs text-muted-foreground">Loading students…</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Students</Label>
              <StudentPicker students={activeStudents} selected={selected} onChange={setSelected} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pe-due">Due date (optional)</Label>
              <Input id="pe-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
            </div>

            {create.isError && <p className="text-sm text-destructive">{create.error instanceof Error ? create.error.message : 'Could not create the exercise'}</p>}
            {created && (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-status-online">
                <CheckCircle2 className="h-4 w-4" />
                Sent to {created.assigned} {created.assigned === 1 ? 'student' : 'students'}.
                <Link to={`/pronunciation/${created.exerciseId}/review`} className="font-medium underline">
                  View results
                </Link>
              </p>
            )}
            <Button
              className="w-full"
              disabled={!canCreate || create.isPending}
              onClick={() => {
                setCreated(null);
                create.mutate();
              }}
            >
              {create.isPending ? 'Creating…' : `Create & send to ${selected.length} ${selected.length === 1 ? 'student' : 'students'}`}
            </Button>
          </CardContent>
        </Card>

        {/* ── Existing exercises table ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Pronunciation Exercises</CardTitle>
            <CardDescription>Open one to assign it to more students or review what's been recorded.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!pronunciationExercises || pronunciationExercises.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Mic className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No pronunciation exercises yet.</p>
                <p className="text-xs text-muted-foreground">Fill in the form on the left to send your first one.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Voice</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pronunciationExercises.map((ex) => {
                    const toReview = ex.submitted - ex.reviewed;
                    return (
                      <TableRow key={ex.id} className="group">
                        <TableCell className="font-medium">{ex.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {ex.config.voice ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {ex.assigned === 0 ? (
                            <span className="text-xs text-muted-foreground">Not assigned</span>
                          ) : toReview > 0 ? (
                            <Badge variant="warning" className="text-xs">
                              {toReview} to review
                            </Badge>
                          ) : (
                            <span className="text-sm">
                              {ex.submitted}/{ex.assigned} submitted
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setAssignTarget({ id: ex.id, title: ex.title })}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Assign
                            </button>
                            <Link
                              to={`/pronunciation/${ex.id}/review`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              Review
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
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

      <AssignPronunciationDialog exercise={assignTarget} onClose={() => setAssignTarget(null)} />
    </div>
  );
}
