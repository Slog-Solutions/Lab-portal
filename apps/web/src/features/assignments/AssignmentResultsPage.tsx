import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { countWords, NO_WRITTEN_FEEDBACK, UserRole } from '@lab/shared';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Eye, Loader2, Mic, PenLine, Rocket, Send, Volume2, X } from 'lucide-react';
import { assessmentsApi, type AssessmentDetail, type VocabQuestionInput } from '../../lib/assessments-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { base64ToAudioUrl, pronunciationApi } from '../../lib/pronunciation-api';
import { usersApi } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from '../exercises/StudentPicker';
import { AudioPreview } from './AudioPreview';
import { DocumentPreview } from './DocumentPreview';
import { LaunchInLabDialog } from './LaunchInLabDialog';
import { VocabularyTestBuilder, validateQuestion } from './VocabularyTestBuilder';
import { DEFAULT_SETTINGS_DRAFT, TestSettingsPanel, settingsDraftToApi, settingsDraftValid, settingsToDraft, type TestSettingsDraft } from './TestSettingsPanel';
import { kindBySlug, kindByType } from './assignment-kinds';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type AssignmentRow = AssessmentDetail['assignments'][number];

function statusOf(row: AssignmentRow): { label: string; variant: 'secondary' | 'warning' | 'success' | 'outline' } {
  switch (row.attempt?.status) {
    case 'SCORED':
      return { label: 'Scored', variant: 'success' };
    case 'SUBMITTED':
      return { label: 'Awaiting review', variant: 'warning' };
    case 'IN_PROGRESS':
      return { label: 'In progress', variant: 'secondary' };
    default:
      return { label: 'Not started', variant: 'outline' };
  }
}

function percentOf(row: AssignmentRow): number | null {
  const a = row.attempt;
  if (a?.status !== 'SCORED' || a.rawScore === null || !a.maxScore) return null;
  return Math.round((a.rawScore / a.maxScore) * 100);
}

/** A writing test: read the essay, give a mark out of 100 and optional
 * feedback (the student sees both). Saving again re-marks. */
function WritingGrade({ test, row, onClose }: { test: AssessmentDetail; row: AssignmentRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const attempt = row.attempt!;
  const essay = attempt.responses[0]?.given ?? '';
  const prompt = test.questions[0]?.prompt ?? '';

  const [score, setScore] = useState(attempt.override ? String(attempt.override.newScore) : '');
  const [feedback, setFeedback] = useState(attempt.override && attempt.override.reason !== NO_WRITTEN_FEEDBACK ? attempt.override.reason : '');
  const value = Number(score);
  const validScore = score.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100;

  const save = useMutation({
    mutationFn: () => assessmentsApi.grade(attempt.id, { score: value, feedback: feedback.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      void queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      onClose();
    },
  });

  return (
    <>
      <div className="space-y-3">
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</p>
          <p className="whitespace-pre-wrap">{prompt}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Essay</span>
            <span className="normal-case tracking-normal">{countWords(essay)} words</span>
          </p>
          <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">{essay || <em className="text-muted-foreground">Nothing was stored for this attempt.</em>}</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="wg-score">Mark (0–100)</Label>
            <Input id="wg-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className="w-28" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wg-feedback">Feedback for the student (optional)</Label>
          <Textarea
            id="wg-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Clear structure — watch your verb tenses."
            className="resize-none"
          />
        </div>
        {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not save the mark'}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => save.mutate()} disabled={!validScore || save.isPending}>
          {save.isPending ? 'Saving…' : attempt.status === 'SCORED' ? 'Save new mark' : 'Save mark'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A reading test: play the student's take, give a mark out of 100 and
 * optional feedback (the student sees both). Saving again re-marks. Same
 * mutation as WritingGrade — both land on GradebookService.override(). */
function ReadingGrade({ test, row, onClose }: { test: AssessmentDetail; row: AssignmentRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const attempt = row.attempt!;
  const recordingId = attempt.responses[0]?.given ?? null; // submitReadingTest stores exactly one
  const passage = test.questions[0]?.prompt ?? '';
  const documentAssetId = test.questions[0]?.mediaAssetId ?? null;
  const voice = test.config.voice ?? 'en_GB';

  const [audio, setAudio] = useState<{ url?: string; failed?: boolean }>({});
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [score, setScore] = useState(attempt.override ? String(attempt.override.newScore) : '');
  const [feedback, setFeedback] = useState(attempt.override && attempt.override.reason !== NO_WRITTEN_FEEDBACK ? attempt.override.reason : '');
  const value = Number(score);
  const validScore = score.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100;

  // Load the student's recording as a blob URL — <audio src> can't carry
  // the teacher's Authorization header, same issue every audio review page
  // in this app has (PronunciationTestResultsPage's GradeDialog, etc.).
  useEffect(() => {
    if (!recordingId) return;
    let cancelled = false;
    let created: string | null = null;
    gradebookApi
      .fetchRecordingBlob(recordingId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setAudio({ url });
      })
      .catch(() => {
        if (!cancelled) setAudio({ failed: true });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [recordingId]);

  useEffect(() => {
    return () => {
      if (modelUrl) URL.revokeObjectURL(modelUrl);
    };
  }, [modelUrl]);

  async function playModel(): Promise<void> {
    if (!passage) return; // nothing to speak — this test only has an uploaded document
    setModelNote(null);
    if (modelUrl) {
      void new Audio(modelUrl).play().catch(() => void 0);
      return;
    }
    setModelBusy(true);
    try {
      const res = await pronunciationApi.speak(passage, voice);
      if (res.audioBase64) {
        const url = base64ToAudioUrl(res.audioBase64);
        setModelUrl(url);
        void new Audio(url).play().catch(() => void 0);
      } else {
        setModelNote(res.warnings[0] ?? "The model voice isn't available on this system.");
      }
    } catch (err) {
      setModelNote(err instanceof Error ? err.message : 'Could not load the model voice');
    } finally {
      setModelBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: () => assessmentsApi.grade(attempt.id, { score: value, feedback: feedback.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      void queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      onClose();
    },
  });

  return (
    <>
      <div className="space-y-3">
        {passage && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Passage</p>
            <p className="whitespace-pre-wrap">{passage}</p>
          </div>
        )}
        {documentAssetId && (
          <div className="rounded-md border border-border p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Document</p>
            <DocumentPreview assetId={documentAssetId} />
          </div>
        )}
        {passage && (
          <div className="space-y-1.5">
            <Button type="button" variant="outline" size="sm" disabled={modelBusy} onClick={() => void playModel()} className="gap-1.5">
              <Volume2 className="h-3.5 w-3.5" />
              {modelBusy ? 'Loading…' : 'Listen to the model'}
            </Button>
            {modelNote && <p className="text-xs text-muted-foreground">{modelNote}</p>}
          </div>
        )}
        <div className="rounded-md border border-border p-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Student&apos;s recording</p>
          {audio.url ? (
            <audio controls src={audio.url} className="h-9 w-full" />
          ) : audio.failed ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> Could not load this recording.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading recording…</p>
          )}
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rg-score">Mark (0–100)</Label>
            <Input id="rg-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className="w-28" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rg-feedback">Feedback for the student (optional)</Label>
          <Textarea
            id="rg-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Clear and well-paced — watch the stress on 'photograph'."
            className="resize-none"
          />
        </div>
        {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not save the mark'}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => save.mutate()} disabled={!validScore || save.isPending}>
          {save.isPending ? 'Saving…' : attempt.status === 'SCORED' ? 'Save new mark' : 'Save mark'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A self-scoring test: what the student answered, question by question. */
function AnswerReview({ test, row, onClose }: { test: AssessmentDetail; row: AssignmentRow; onClose: () => void }) {
  const attempt = row.attempt!;
  const byId = new Map(test.questions.map((q) => [q.id, q]));
  // Iterate the student's own responses, not every question — with "questions
  // per student" each student only saw a random subset.
  const shown = attempt.responses.flatMap((r) => {
    const question = byId.get(r.itemId);
    return question ? [{ question, response: r }] : [];
  });

  return (
    <>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No per-question answers were stored for this attempt.</p>
      ) : (
        <div className="space-y-2">
          {shown.map(({ question, response }, i) => (
            <div key={question.id} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">
                <span className="mr-1.5 text-xs font-normal text-muted-foreground">{i + 1}.</span>
                {question.prompt}
              </p>
              <p className="mt-1 flex items-center gap-1.5">
                {response.correct ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-destructive" />}
                {response.given.trim() ? response.given : <em className="text-muted-foreground">no answer</em>}
              </p>
              {!response.correct && question.answer && <p className="mt-0.5 text-xs text-muted-foreground">Correct answer: {question.answer}</p>}
            </div>
          ))}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

type AttemptDialogMode = 'writing' | 'reading' | 'answers';

function modeOf(type: string): AttemptDialogMode {
  if (type === 'WRITING_TEST') return 'writing';
  if (type === 'READING_TEST') return 'reading';
  return 'answers';
}

function AttemptDialog({ test, row, onClose }: { test: AssessmentDetail; row: AssignmentRow; onClose: () => void }) {
  const mode = modeOf(test.type);
  const pct = percentOf(row);
  const icon =
    mode === 'writing' ? <PenLine className="h-4 w-4 text-primary" /> : mode === 'reading' ? <Mic className="h-4 w-4 text-primary" /> : <Eye className="h-4 w-4 text-primary" />;
  const title = mode === 'writing' ? 'Mark' : mode === 'reading' ? 'Listen & mark' : 'Answers';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {title} — {row.student.fullName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {row.student.serviceNumber}
            {pct !== null && ` · ${pct}%`}
          </p>
        </DialogHeader>
        {mode === 'writing' ? (
          <WritingGrade test={test} row={row} onClose={onClose} />
        ) : mode === 'reading' ? (
          <ReadingGrade test={test} row={row} onClose={onClose} />
        ) : (
          <AnswerReview test={test} row={row} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Results for one assignment: who has handed in, their answers, and — for a
 * writing test — the marking entry point. Refreshes itself while open so
 * submissions appear during class. */
export function AssignmentResultsPage() {
  const { kind: slug, id } = useParams<{ kind: string; id: string }>();
  const queryClient = useQueryClient();

  const { data: test, isLoading, error } = useQuery({
    queryKey: queryKeys.assessment(id!),
    queryFn: () => assessmentsApi.get(id!),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
  const { data: students } = useQuery({ queryKey: queryKeys.users(UserRole.STUDENT), queryFn: () => usersApi.list(UserRole.STUDENT) });

  const [openId, setOpenId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState<string[]>([]);

  const send = useMutation({
    mutationFn: () => gradebookApi.createAssignments({ studentIds: sendTo, exerciseIds: [id!] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      setSendTo([]);
    },
  });

  // SPEC-mcq-test-timed-reveal.md §7.4/§7.6 — vocabulary-test-only UI:
  // launching in the lab, re-editing (only while `test.editable`), and
  // releasing an ON_TEACHER_RELEASE test's results (only the
  // assignment/individual path here — a lab run's own release is a button
  // on its own live board, see LiveTestBoardPage).
  const [showLaunch, setShowLaunch] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editQuestions, setEditQuestions] = useState<VocabQuestionInput[]>([]);
  const [editSettings, setEditSettings] = useState<TestSettingsDraft>(DEFAULT_SETTINGS_DRAFT);

  function invalidateTest(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.assessment(id!) });
  }

  function startEditing(current: AssessmentDetail): void {
    setEditTitle(current.title);
    setEditQuestions(
      current.questions.map((q) => ({
        prompt: q.prompt,
        options: q.choices.length > 0 ? q.choices : [q.answer ?? '', ''],
        correctIndex: q.correctIndex ?? 0,
        explanation: q.explanation,
        mediaAssetId: q.mediaAssetId,
      })),
    );
    setEditSettings(settingsToDraft(current.settings));
    setEditing(true);
  }

  const saveEdit = useMutation({
    mutationFn: () =>
      assessmentsApi.update(id!, {
        title: editTitle.trim() || undefined,
        questions: editQuestions,
        ...settingsDraftToApi(editSettings),
      }),
    onSuccess: () => {
      invalidateTest();
      setEditing(false);
    },
  });
  const editValid = editTitle.trim().length > 0 && editQuestions.length > 0 && editQuestions.every((q) => validateQuestion(q).length === 0) && settingsDraftValid(editSettings);

  const release = useMutation({ mutationFn: () => assessmentsApi.release(id!), onSuccess: invalidateTest });

  // Back link goes to the assignment's real type, whatever the URL said.
  // kindByType can miss (the server's ASSESSMENT_TYPES and this page's
  // ASSIGNMENT_KINDS are maintained separately), so fall back to the slug
  // the URL already gave us, then to vocabulary.
  const kind = (test && kindByType(test.type)) ?? kindBySlug(slug) ?? kindBySlug('vocabulary')!;
  const backTo = `/assignments/${kind.slug}`;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error || !test) {
    return (
      <div className="space-y-2">
        <Link to={backTo} className="text-sm text-primary hover:underline">
          ← {kind.label}
        </Link>
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Assignment not found'}</p>
      </div>
    );
  }

  const mode = modeOf(test.type);
  const isVocab = test.type === 'VOCABULARY_TEST';
  const isWriting = test.type === 'WRITING_TEST'; // only the word-count badges below still need this specifically
  const isHandMarked = mode === 'writing' || mode === 'reading';
  const openRow = openId ? test.assignments.find((a) => a.assignmentId === openId) : undefined;
  const toMark = test.assignments.filter((a) => a.attempt?.status === 'SUBMITTED').length;
  // §6.4 "Teacher/admin → always full detail" — get() never masks this
  // page's own view, so a SCORED-but-not-yet-visible-to-the-student row is
  // told apart by revealAt alone, not by status.
  const pendingRelease = test.assignments.filter((a) => a.attempt?.status === 'SCORED' && a.attempt.revealAt === null).length;
  const tagFor = (studentId: string): string | null => {
    const mine = test.assignments.filter((a) => a.student.id === studentId);
    if (mine.length === 0) return null;
    return mine.some((a) => a.attempt?.status === 'SCORED' || a.attempt?.status === 'SUBMITTED') ? 'already submitted' : 'already assigned';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to={backTo} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            {kind.label}
          </Link>
          <h1 className="text-xl font-semibold">{test.title}</h1>
          {test.config.instructions && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{test.config.instructions}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {isWriting && test.config.minWords && <Badge variant="outline">Min {test.config.minWords} words</Badge>}
          {isWriting && test.config.maxWords && <Badge variant="outline">Max {test.config.maxWords} words</Badge>}
          {toMark > 0 && <Badge variant="warning">{toMark} to mark</Badge>}
          {isVocab && !editing && (
            <>
              {test.editable && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => startEditing(test)}>
                  <PenLine className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {pendingRelease > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => release.mutate()} disabled={release.isPending}>
                  <Send className="h-3.5 w-3.5" /> {release.isPending ? 'Releasing…' : `Release results (${pendingRelease})`}
                </Button>
              )}
              <Button size="sm" className="gap-1.5" onClick={() => setShowLaunch(true)}>
                <Rocket className="h-3.5 w-3.5" /> Launch in lab
              </Button>
            </>
          )}
        </div>
      </div>

      {isVocab && editing ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Edit questions</CardTitle>
            <CardDescription>Blocked automatically once this test has any attempt or lab run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
            </div>
            <VocabularyTestBuilder questions={editQuestions} onChange={setEditQuestions} />
            <TestSettingsPanel value={editSettings} onChange={setEditSettings} questionCount={editQuestions.length} />
            {saveEdit.isError && <p className="text-sm text-destructive">{saveEdit.error instanceof Error ? saveEdit.error.message : 'Could not save'}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saveEdit.isPending}>
                Cancel
              </Button>
              <Button onClick={() => saveEdit.mutate()} disabled={!editValid || saveEdit.isPending}>
                {saveEdit.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{mode === 'writing' ? 'Prompt' : mode === 'reading' ? 'Passage' : `Questions (${test.questions.length})`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {test.type === 'LISTENING_TEST' && test.config.audioAssetId && <AudioPreview assetId={test.config.audioAssetId} />}
            {isHandMarked ? (
              <>
                {test.questions[0]?.prompt && <p className="whitespace-pre-wrap text-sm">{test.questions[0].prompt}</p>}
                {mode === 'reading' && test.questions[0]?.mediaAssetId && <DocumentPreview assetId={test.questions[0].mediaAssetId} />}
              </>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {test.questions.map((q, i) => (
                  <li key={q.id}>
                    <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                    {q.prompt} <span className="text-muted-foreground">→</span> <span className="font-medium">{q.answer}</span>
                    {q.choices.length > 1 && <span className="ml-1.5 text-xs text-muted-foreground">(choices: {q.choices.join(', ')})</span>}
                    {q.explanation && <span className="ml-1.5 block text-xs text-muted-foreground">↳ {q.explanation}</span>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {isVocab && test.labRuns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lab runs</CardTitle>
            <CardDescription>Every time this test was launched live in the lab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {test.labRuns.map((run) => {
              const submitted = run.attempts.filter((a) => a.status === 'SUBMITTED' || a.status === 'SCORED').length;
              return (
                <div key={run.activityInstanceId} className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm">
                  <div>
                    <p className="font-medium">{run.sessionTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {submitted}/{run.attempts.length} submitted · {run.status === 'CLOSED' ? (run.revealedAt ? 'Revealed' : 'Closed') : run.status === 'READY' ? 'Not started' : 'Running'}
                      {run.startedAt && ` · ${new Date(run.startedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <Link to={`/tests/live/${run.activityInstanceId}`} className="text-xs font-medium text-primary hover:underline">
                    Open board
                  </Link>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>
              Updates automatically.{' '}
              {mode === 'writing'
                ? 'Open a submission to read it and give a mark.'
                : mode === 'reading'
                  ? 'Open a submission to listen to it and give a mark.'
                  : 'Open a submission to see the answers.'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSend((v) => !v)}>
            {showSend ? 'Close' : 'Send to more students'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          {showSend && (
            <div className="mx-4 space-y-3 rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Sending again to a student who already submitted gives them a fresh attempt — their earlier answers and mark are kept.
              </p>
              <StudentPicker students={(students ?? []).filter((s) => s.active)} selected={sendTo} onChange={setSendTo} tag={(s) => tagFor(s.id)} />
              {send.isError && <p className="text-sm text-destructive">{send.error instanceof Error ? send.error.message : 'Could not send'}</p>}
              {send.isSuccess && (
                <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Sent.
                </p>
              )}
              <Button size="sm" disabled={sendTo.length === 0 || send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? 'Sending…' : `Send to ${sendTo.length} ${sendTo.length === 1 ? 'student' : 'students'}`}
              </Button>
            </div>
          )}

          {test.assignments.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Not assigned to anyone yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {test.assignments.map((row) => {
                  const status = statusOf(row);
                  const pct = percentOf(row);
                  const done = row.attempt?.status === 'SUBMITTED' || row.attempt?.status === 'SCORED';
                  return (
                    <TableRow key={row.assignmentId}>
                      <TableCell>
                        <p className="font-medium">{row.student.fullName}</p>
                        <p className="text-xs text-muted-foreground">{row.student.serviceNumber}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {pct !== null ? (
                          <span className="font-medium">{pct}%</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {isVocab && row.attempt?.status === 'SCORED' && row.attempt.revealAt === null && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(hidden from student)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.dueAt ? new Date(row.dueAt).toLocaleDateString() : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.attempt?.submittedAt ? new Date(row.attempt.submittedAt).toLocaleString() : '—'}</TableCell>
                      <TableCell>
                        {done && (
                          <Button
                            size="sm"
                            variant={isHandMarked && row.attempt?.status === 'SUBMITTED' ? 'default' : 'outline'}
                            className="gap-1.5"
                            onClick={() => setOpenId(row.assignmentId)}
                          >
                            {mode === 'writing' ? <PenLine className="h-3.5 w-3.5" /> : mode === 'reading' ? <Mic className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            {mode === 'writing'
                              ? row.attempt?.status === 'SCORED'
                                ? 'Re-mark'
                                : 'Read & mark'
                              : mode === 'reading'
                                ? row.attempt?.status === 'SCORED'
                                  ? 'Re-mark'
                                  : 'Listen & mark'
                                : 'View answers'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openRow?.attempt && <AttemptDialog key={openRow.attempt.id} test={test} row={openRow} onClose={() => setOpenId(null)} />}
      {isVocab && <LaunchInLabDialog open={showLaunch} onOpenChange={setShowLaunch} exerciseId={test.id} />}
    </div>
  );
}
