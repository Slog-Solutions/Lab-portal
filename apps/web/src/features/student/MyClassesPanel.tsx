import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { BatchErrorCode } from '@lab/shared';
import { ApiError } from '../../lib/api-client';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';
import { useStudentSession } from '../../stores/student-session-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const LAST_ACTIVE_KEY = 'lab-last-active-batch';

// localStorage can throw or come back empty (private window, blocked site
// data) — this is a convenience only, never state the page depends on.
function readLastActive(): string | null {
  try {
    return localStorage.getItem(LAST_ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeLastActive(batchId: string): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, batchId);
  } catch {
    /* convenience only */
  }
}

/** Maps a failed join to the wording students see. Keyed on the server's
 * machine-readable `code` (and 429 for the rate limit), never on its prose. */
function joinErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === BatchErrorCode.JOIN_INVALID) return "That class code or key doesn't match. Check with your teacher.";
    if (err.code === BatchErrorCode.JOIN_CLOSED) return "This class isn't accepting new students right now.";
    if (err.status === 429) return 'Too many tries. Wait a few minutes and try again.';
    // A 400 here is the form's own validation (e.g. a too-short key) — its
    // message says exactly which field, so show it.
    if (err.status === 400) return err.message;
  }
  return 'Could not join the class. Please try again.';
}

/**
 * A student's home for classes. Signing in never needs a class (see
 * StudentSignInScreen), so the zero-class state is a first-class screen
 * here, not an error: a friendly explanation and a Join button, while the
 * rest of the console (assignments, self-study) stays fully reachable.
 *
 * Joining is by class code + join key (POST /batches/join, authenticated
 * with the student's own JWT — the dashboard login in a browser, or the
 * session minted at seat sign-in). The code is normalised (trim +
 * uppercase) before sending; the key is sent exactly as typed, because the
 * server compares it case-sensitively.
 *
 * Opening a class (`onOpen`) shows what the student did there — see
 * StudentClassDetail.
 *
 * `lastActiveBatchId` (localStorage) only remembers which class was last
 * opened or joined, to highlight it — a convenience. It is never sent anywhere and never authorises
 * anything — the server decides membership from Enrollment rows.
 */
export function MyClassesPanel({ onOpen }: { onOpen: (batchId: string) => void }) {
  const dashboardUser = useAuthStore((s) => s.user);
  const student = useStudentSession((s) => s.student);
  const isStudent = dashboardUser?.role === 'STUDENT' || student !== null;
  const queryClient = useQueryClient();
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => readLastActive());

  const { data: classes, isPending, isError } = useQuery({
    queryKey: queryKeys.myClasses,
    queryFn: batchesApi.mine,
    enabled: isStudent,
  });

  function markActive(batchId: string): void {
    setActiveId(batchId);
    writeLastActive(batchId);
  }

  function openClass(batchId: string): void {
    markActive(batchId);
    onOpen(batchId);
  }

  const join = useMutation({
    mutationFn: () => batchesApi.join({ code: code.trim().toUpperCase(), joinKey }),
    onSuccess: (res) => {
      setCode('');
      setJoinKey('');
      setError(null);
      setShowJoin(false);
      markActive(res.batch.id);
      // Already enrolled is a success, not an error — straight to the class.
      setNotice(res.alreadyEnrolled ? `You're already in ${res.batch.name}.` : `You joined ${res.batch.name}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myClasses });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myEnrollments });
    },
    onError: (err) => {
      setNotice(null);
      setError(joinErrorMessage(err));
    },
  });

  if (!isStudent) return null;

  const hasClasses = (classes?.length ?? 0) > 0;
  const joinForm = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="join-class-code">Class code</Label>
          <Input
            id="join-class-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. ACTC-B02"
            className="w-40 uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="join-class-key">Join key</Label>
          <Input
            id="join-class-key"
            value={joinKey}
            onChange={(e) => setJoinKey(e.target.value)}
            placeholder="Given by your teacher"
            className="w-48"
          />
        </div>
        <Button onClick={() => join.mutate()} disabled={join.isPending || !code.trim() || !joinKey.trim()}>
          {join.isPending ? 'Joining…' : 'Join'}
        </Button>
        {hasClasses && (
          <Button variant="ghost" onClick={() => setShowJoin(false)}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">My classes</CardTitle>
        {hasClasses && !showJoin && (
          <Button variant="ghost" size="sm" onClick={() => setShowJoin(true)}>
            Join another class
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">Could not load your classes.</p>}
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}

        {classes && !hasClasses && !showJoin && (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <div>
              <p className="text-sm font-medium">You're not in a class yet.</p>
              <p className="text-sm text-muted-foreground">Ask your teacher for a class code, then join below.</p>
            </div>
            <Button onClick={() => setShowJoin(true)}>Join a class</Button>
          </div>
        )}

        {classes && hasClasses && (
          <ul className="space-y-2">
            {classes.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openClass(c.id)}
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${active ? 'border-primary' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge variant="outline">{c.code}</Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {c.teacherNames.length > 0 ? `Taught by ${c.teacherNames.join(', ')}` : 'No teacher assigned yet'} · {c.studentCount}{' '}
                        {c.studentCount === 1 ? 'student' : 'students'}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {showJoin && joinForm}
      </CardContent>
    </Card>
  );
}
