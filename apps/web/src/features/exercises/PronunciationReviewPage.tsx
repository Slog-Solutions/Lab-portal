import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mic, Volume2, Star, CheckCircle2, PlayCircle, Loader2, AlertTriangle } from 'lucide-react';
import { exercisesApi } from '../../lib/exercises-api';
import { gradebookApi, type AttemptRow } from '../../lib/gradebook-api';
import { pronunciationApi, base64ToAudioUrl } from '../../lib/pronunciation-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PronunciationConfig {
  sourceText: string;
  voice: 'en_US' | 'en_GB';
  ipaAssetId?: string;
  modelAudioAssetId?: string;
}

/** The student's 1-5 self-rating. There is no separate selfAssessedScore
 * field anywhere in the API — AttemptsService.submitPronunciation stores it
 * straight into Attempt.rawScore on the activity's native 0-5 scale (see
 * schema.prisma's Attempt comment), so it only reads as a self-score before
 * a teacher's ScoreOverride replaces rawScore with a 0-100 value. */
function selfScoreOf(attempt: AttemptRow): number | null {
  if (attempt.scoreOverride) return null;
  if (attempt.rawScore === null || attempt.maxScore !== 5) return null;
  return attempt.rawScore;
}

/** Attempt detail view used in the inline review dialog. Shows student
 * recording playback, self-score, and teacher score override. */
function AttemptReviewDialog({
  attempt,
  onClose,
}: {
  attempt: AttemptRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [newScore, setNewScore] = useState('');
  const [reason, setReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Load student recording as blob URL when dialog opens
  useEffect(() => {
    if (!attempt) return;
    // Clean up previous blob
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      setAudioUrl(null);
    }

    // First try loading the full attempt details to find recordings
    setAudioLoading(true);
    gradebookApi
      .getAttempt(attempt.id)
      .then((full: unknown) => {
        const f = full as {
          // Server orders these newest-first (gradebook.service.ts's
          // getAttempt) — a student can Improvise (re-record) any number
          // of times before submitting, so the newest READY one is the
          // take that was actually submitted, not necessarily [0].
          recordings?: Array<{ id: string; status: string }>;
        };
        const recordingId = f.recordings?.find((r) => r.status === 'ready')?.id;
        if (!recordingId) {
          setAudioLoading(false);
          return;
        }
        return gradebookApi
          .fetchRecordingBlob(recordingId)
          .then((url) => {
            urlRef.current = url;
            setAudioUrl(url);
          })
          .catch(() => {
            setAudioError('Could not load recording.');
          })
          .finally(() => setAudioLoading(false));
      })
      .catch(() => {
        setAudioLoading(false);
        setAudioError('Could not load attempt details.');
      });

    // Prefill score from current rawScore
    const pct =
      attempt.rawScore !== null && attempt.maxScore
        ? Math.round((attempt.rawScore / attempt.maxScore) * 100)
        : attempt.rawScore !== null
          ? Math.round(attempt.rawScore * 20) // 1-5 self score → 0-100%
          : '';
    setNewScore(String(pct));

    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [attempt?.id]);

  const override = useMutation({
    mutationFn: () => gradebookApi.override(attempt!.id, Number(newScore), reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      void queryClient.invalidateQueries({ queryKey: ['pronunciation'] });
      onClose();
    },
    onError: (err) => setOverrideError(err instanceof Error ? err.message : 'Override failed'),
  });

  if (!attempt) return null;

  const selfScore = selfScoreOf(attempt);
  const existingOverride = attempt.scoreOverride;

  return (
    <Dialog open={!!attempt} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            Review — {attempt.student.fullName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{attempt.student.serviceNumber}</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Student recording */}
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-1.5">
              <PlayCircle className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Student Recording</p>
            </div>
            {audioLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading recording…
              </div>
            )}
            {audioError && (
              <div className="flex items-center gap-1.5 text-xs text-status-pending">
                <AlertTriangle className="h-3.5 w-3.5" /> {audioError}
              </div>
            )}
            {audioUrl && <audio controls src={audioUrl} className="w-full h-10" />}
            {!audioLoading && !audioUrl && !audioError && (
              <p className="text-xs text-muted-foreground">No recording available.</p>
            )}
          </div>

          {/* Self-assessed score */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
              <span className="text-muted-foreground">Student self-score:</span>
              {selfScore !== null ? (
                <span className="font-semibold">{selfScore}/5</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            {existingOverride && (
              <Badge variant="warning" className="text-xs">
                Teacher score: {existingOverride.newScore}%
              </Badge>
            )}
            <Badge variant={attempt.status === 'SCORED' ? 'success' : 'secondary'} className="text-xs">
              {attempt.status}
            </Badge>
          </div>

          {/* Teacher score override */}
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-sm font-medium">Assign Teacher Score</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="teacher-score">Score (0 – 100)</Label>
                <Input
                  id="teacher-score"
                  type="number"
                  min={0}
                  max={100}
                  value={newScore}
                  onChange={(e) => setNewScore(e.target.value)}
                  placeholder="e.g. 75"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">Reason / feedback (required)</Label>
              <Textarea
                id="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Good intonation, slight vowel error on 'fox'."
                rows={3}
              />
            </div>
            {overrideError && <p className="text-sm text-destructive">{overrideError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => override.mutate()}
            disabled={override.isPending || !reason.trim() || newScore === ''}
          >
            {override.isPending ? 'Saving…' : 'Save Teacher Score'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ser 7 — Teacher review page for a single pronunciation exercise.
 * Lists every student attempt, shows self-assessment, playback button,
 * and lets the teacher assign a score via an audited ScoreOverride. */
export function PronunciationReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [reviewTarget, setReviewTarget] = useState<AttemptRow | null>(null);
  const [modelAudioUrl, setModelAudioUrl] = useState<string | null>(null);
  const [ipaText, setIpaText] = useState<string | null>(null);
  const modelUrlRef = useRef<string | null>(null);

  const { data: exercise, isLoading: exLoading } = useQuery({
    queryKey: queryKeys.exercise(id!),
    queryFn: () => exercisesApi.get(id!),
  });

  const { data: attempts, isLoading: attLoading } = useQuery({
    queryKey: queryKeys.pronunciationAttempts(id!),
    queryFn: () => gradebookApi.listAttempts({ exerciseId: id! }),
    enabled: Boolean(id),
  });

  const { data: assignments } = useQuery({
    queryKey: queryKeys.gradebookAssignments({ exerciseId: id }),
    queryFn: () => gradebookApi.listAssignments({ exerciseId: id! }),
    enabled: Boolean(id),
  });

  // Load model audio + IPA for preview in the header. Most exercises now
  // come from the one-step form (PronunciationAuthoringPage), which never
  // pre-generates these — so absent both asset ids, fall back to the same
  // on-demand pipeline the student's "Listen to pronunciation" button uses,
  // rather than showing an empty preview.
  useEffect(() => {
    if (!exercise) return;
    const cfg = exercise.config as Partial<PronunciationConfig>;

    if (cfg.ipaAssetId) {
      gradebookApi
        .fetchMediaAssetText(cfg.ipaAssetId)
        .then((t) => setIpaText(t.trim()))
        .catch(() => setIpaText(null));
    }

    if (cfg.modelAudioAssetId) {
      if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
      gradebookApi
        .fetchMediaAssetBlob(cfg.modelAudioAssetId)
        .then((url) => {
          modelUrlRef.current = url;
          setModelAudioUrl(url);
        })
        .catch(() => setModelAudioUrl(null));
    }

    if (!cfg.ipaAssetId && !cfg.modelAudioAssetId && cfg.sourceText) {
      pronunciationApi
        .speak(cfg.sourceText, cfg.voice ?? 'en_GB')
        .then((res) => {
          if (res.ipa) setIpaText(res.ipa);
          if (res.audioBase64) {
            if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
            const url = base64ToAudioUrl(res.audioBase64);
            modelUrlRef.current = url;
            setModelAudioUrl(url);
          }
        })
        .catch(() => void 0); // preview is a nicety — grading doesn't depend on it
    }

    return () => {
      if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
    };
  }, [exercise?.id]);

  if (exLoading || !exercise) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading exercise…
      </div>
    );
  }

  const cfg = exercise.config as PronunciationConfig;
  const submittedAttempts = attempts?.filter((a) => a.status !== 'IN_PROGRESS') ?? [];
  const scoredCount = submittedAttempts.filter((a) => a.status === 'SCORED').length;
  const submittedStudentIds = new Set(submittedAttempts.map((a) => a.studentId));
  const notYetSubmitted = (assignments ?? []).filter((a) => !submittedStudentIds.has(a.studentId));

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/pronunciation"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Pronunciation
          </Link>
          <h1 className="text-xl font-semibold">{exercise.title}</h1>
          <p className="text-sm text-muted-foreground">Student attempt review — Annexure-I Ser 7</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{cfg.voice}</Badge>
          <Badge variant="secondary">
            {scoredCount}/{submittedAttempts.length} scored
          </Badge>
        </div>
      </div>

      {/* ── Exercise preview card ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Volume2 className="h-4 w-4 text-primary" />
            Exercise Content
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Source text */}
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Source Text</p>
            <p className="text-lg font-medium leading-relaxed">{cfg.sourceText}</p>
          </div>

          {/* IPA */}
          {ipaText && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">IPA Transcription</p>
              <p className="font-mono text-sm text-muted-foreground">{ipaText}</p>
            </div>
          )}

          {/* Model audio */}
          {modelAudioUrl && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Model Audio ({cfg.voice})
              </p>
              <audio controls src={modelAudioUrl} className="h-10 w-full max-w-sm" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Assigned but not yet answered ────────────────────────────── */}
      {notYetSubmitted.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Waiting on {notYetSubmitted.length} {notYetSubmitted.length === 1 ? 'student' : 'students'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {notYetSubmitted.map((a) => (
              <Badge key={a.id} variant="secondary" className="text-xs">
                {a.student.fullName}
                {a.dueAt && ` · due ${new Date(a.dueAt).toLocaleDateString()}`}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Attempts table ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Student Attempts</CardTitle>
          <CardDescription>
            Click "Review" to hear a student's recording and assign a teacher score.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {attLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading attempts…
            </div>
          ) : submittedAttempts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Mic className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No submitted attempts yet.</p>
              <p className="text-xs text-muted-foreground">
                Students must be assigned this exercise and submit their recording.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Self Score</TableHead>
                  <TableHead>Teacher Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {submittedAttempts.map((a) => {
                  const selfScoreRaw = selfScoreOf(a);
                  const teacherScore = a.scoreOverride?.newScore;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{a.student.fullName}</p>
                          <p className="text-xs text-muted-foreground">{a.student.serviceNumber}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        {selfScoreRaw !== undefined && selfScoreRaw !== null ? (
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                className={`h-3.5 w-3.5 ${
                                  i < selfScoreRaw
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                            <span className="ml-1 text-xs text-muted-foreground">{selfScoreRaw}/5</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {teacherScore !== undefined ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            <span className="font-medium">{teacherScore}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not scored</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'SCORED' ? 'success' : 'secondary'} className="text-xs">
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={a.status === 'SCORED' ? 'outline' : 'default'}
                          onClick={() => setReviewTarget(a)}
                          className="gap-1.5"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {a.status === 'SCORED' ? 'Re-review' : 'Review'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AttemptReviewDialog attempt={reviewTarget} onClose={() => setReviewTarget(null)} />
    </div>
  );
}
