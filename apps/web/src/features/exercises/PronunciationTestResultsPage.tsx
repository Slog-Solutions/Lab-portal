import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@lab/shared';
import { AlertTriangle, ArrowLeft, CheckCircle2, Headphones, Loader2, PlayCircle, Volume2 } from 'lucide-react';
import {
  base64ToAudioUrl,
  pronunciationApi,
  type PronunciationTestDetail,
} from '../../lib/pronunciation-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { usersApi } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from './StudentPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type AssignmentRow = PronunciationTestDetail['assignments'][number];

const AUTO_REASON_PREFIX = 'Per-word pronunciation ratings';

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

/** Hear each word's recording (and the model voice, if you want a
 * reference), rate every word 1-5, and save. The attempt's score is the
 * average rating as a percentage; saving again re-grades. */
function GradeDialog({ test, row, onClose }: { test: PronunciationTestDetail; row: AssignmentRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const attempt = row.attempt!;
  const voice = test.config.voice ?? 'en_GB';

  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const r of attempt.responses) if (r.score !== null) initial[r.itemId] = r.score;
    return initial;
  });
  const [feedback, setFeedback] = useState(() =>
    attempt.override && !attempt.override.reason.startsWith(AUTO_REASON_PREFIX) ? attempt.override.reason : '',
  );
  const [audio, setAudio] = useState<Record<string, { url?: string; failed?: boolean }>>({});
  const [modelBusy, setModelBusy] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const modelUrls = useRef<Map<string, string>>(new Map());

  // Load every word's recording as a blob URL (an <audio src> can't carry
  // the teacher's Authorization header). `cancelled` guards a fetch that
  // resolves after the dialog closed — its URL is revoked on the spot.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    for (const r of attempt.responses) {
      gradebookApi
        .fetchRecordingBlob(r.recordingId)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          created.push(url);
          setAudio((prev) => ({ ...prev, [r.itemId]: { url } }));
        })
        .catch(() => {
          if (!cancelled) setAudio((prev) => ({ ...prev, [r.itemId]: { failed: true } }));
        });
    }
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [attempt.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const urls = modelUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  async function playModel(itemId: string, word: string): Promise<void> {
    setModelNote(null);
    let url = modelUrls.current.get(word);
    if (!url) {
      setModelBusy(itemId);
      try {
        const res = await pronunciationApi.speak(word, voice);
        if (!res.audioBase64) {
          setModelNote(res.warnings[0] ?? 'The model voice is not available on this server.');
          return;
        }
        url = base64ToAudioUrl(res.audioBase64);
        modelUrls.current.set(word, url);
      } catch (err) {
        setModelNote(err instanceof Error ? err.message : 'Could not load the model voice');
        return;
      } finally {
        setModelBusy(null);
      }
    }
    void new Audio(url).play().catch(() => void 0);
  }

  const ratedCount = test.words.filter((w) => ratings[w.id] !== undefined).length;
  const allRated = ratedCount === test.words.length;
  const average = allRated ? test.words.reduce((sum, w) => sum + ratings[w.id]!, 0) / test.words.length : null;
  const preview = average === null ? null : Math.round((average / 5) * 100);

  const save = useMutation({
    mutationFn: () =>
      pronunciationApi.tests.grade(attempt.id, {
        ratings: test.words.map((w) => ({ itemId: w.id, score: ratings[w.id]! })),
        feedback: feedback.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationTest(test.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationTests });
      void queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-primary" />
            Grade — {row.student.fullName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {row.student.serviceNumber} · 1 = unclear · 3 = acceptable · 5 = excellent
          </p>
        </DialogHeader>

        <div className="space-y-2">
          {test.words.map((w, i) => {
            const a = audio[w.id];
            return (
              <div key={w.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-semibold">
                    <span className="mr-2 text-xs font-normal text-muted-foreground">{i + 1}.</span>
                    {w.word}
                  </p>
                  <Button variant="ghost" size="sm" className="gap-1.5" disabled={modelBusy === w.id} onClick={() => void playModel(w.id, w.word)}>
                    {modelBusy === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                    Model
                  </Button>
                </div>
                {a?.url ? (
                  <audio controls src={a.url} className="h-9 w-full" />
                ) : a?.failed ? (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Could not load this recording.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading recording…
                  </p>
                )}
                <div className="flex gap-1.5" role="group" aria-label={`Rating for ${w.word}`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRatings((prev) => ({ ...prev, [w.id]: n }))}
                      aria-pressed={ratings[w.id] === n}
                      className={`h-8 w-8 rounded-md border text-sm ${
                        ratings[w.id] === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent/50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {modelNote && <p className="text-xs text-amber-600 dark:text-amber-400">{modelNote}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grade-feedback">Feedback for the student (optional)</Label>
          <Textarea
            id="grade-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={`e.g. Good overall — watch the "r" in "rural".`}
          />
        </div>

        {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not save the grade'}</p>}

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm">
            {preview !== null ? (
              <>
                Score: <span className="font-semibold">{preview}%</span> <span className="text-muted-foreground">(avg {average!.toFixed(1)}/5)</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Rate every word to save ({test.words.length - ratedCount} left)
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={!allRated || save.isPending}>
              {save.isPending ? 'Saving…' : attempt.status === 'SCORED' ? 'Save new grade' : 'Save grade'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Results for one pronunciation test: who has submitted, and the grading
 * entry point. Refreshes itself while open so submissions appear during class. */
export function PronunciationTestResultsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: test, isLoading, error } = useQuery({
    queryKey: queryKeys.pronunciationTest(id!),
    queryFn: () => pronunciationApi.tests.get(id!),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
  const { data: students } = useQuery({ queryKey: queryKeys.users(UserRole.STUDENT), queryFn: () => usersApi.list(UserRole.STUDENT) });

  const [gradingId, setGradingId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState<string[]>([]);

  const send = useMutation({
    mutationFn: () => gradebookApi.createAssignments({ studentIds: sendTo, exerciseIds: [id!] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationTest(id!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationTests });
      setSendTo([]);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading test…
      </div>
    );
  }
  if (error || !test) {
    return (
      <div className="space-y-2">
        <Link to="/pronunciation-tests" className="text-sm text-primary hover:underline">
          ← Pronunciation Tests
        </Link>
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Test not found'}</p>
      </div>
    );
  }

  const gradingRow = gradingId ? test.assignments.find((a) => a.assignmentId === gradingId) : undefined;
  const tagFor = (studentId: string): string | null => {
    const mine = test.assignments.filter((a) => a.student.id === studentId);
    if (mine.length === 0) return null;
    return mine.some((a) => a.attempt?.status === 'SCORED' || a.attempt?.status === 'SUBMITTED') ? 'already submitted' : 'already assigned';
  };
  const toGrade = test.assignments.filter((a) => a.attempt?.status === 'SUBMITTED').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/pronunciation-tests" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Pronunciation Tests
          </Link>
          <h1 className="text-xl font-semibold">{test.title}</h1>
          {test.config.instructions && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{test.config.instructions}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Badge variant="outline">{test.config.playModelAudio ? 'Students can hear the words' : 'Words shown as text only'}</Badge>
          {toGrade > 0 && <Badge variant="warning">{toGrade} to grade</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Words ({test.words.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {test.words.map((w, i) => (
            <Badge key={w.id} variant="secondary" className="text-sm">
              {i + 1}. {w.word}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>Updates automatically. Open a submission to listen and rate each word.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSend((v) => !v)}>
            {showSend ? 'Close' : 'Send to more students'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          {showSend && (
            <div className="mx-4 space-y-3 rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Sending again to a student who already submitted gives them a fresh attempt — their earlier recordings and score are kept.
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
                  <TableHead>Submitted</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {test.assignments.map((row) => {
                  const status = statusOf(row);
                  const canGrade = row.attempt?.status === 'SUBMITTED' || row.attempt?.status === 'SCORED';
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
                        {row.attempt?.status === 'SCORED' && row.attempt.override ? (
                          <span className="font-medium">{row.attempt.override.newScore}%</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.attempt?.submittedAt ? new Date(row.attempt.submittedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        {canGrade && (
                          <Button size="sm" variant={row.attempt?.status === 'SCORED' ? 'outline' : 'default'} className="gap-1.5" onClick={() => setGradingId(row.assignmentId)}>
                            <PlayCircle className="h-3.5 w-3.5" />
                            {row.attempt?.status === 'SCORED' ? 'Re-grade' : 'Listen & grade'}
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

      {gradingRow?.attempt && <GradeDialog key={gradingRow.attempt.id} test={test} row={gradingRow} onClose={() => setGradingId(null)} />}
    </div>
  );
}
