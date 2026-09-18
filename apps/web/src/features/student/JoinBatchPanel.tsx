import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';
import { useStudentSession } from '../../stores/student-session-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * LMS admin core, student half: `batchesApi.join`/`myEnrollments` had a
 * client wrapper and a server route (`POST /batches/join`, throttled,
 * uniform failure message — see BatchesService's doc comment) with zero
 * UI caller, the same "orphaned API client" shape UsersPage fixed for the
 * admin side.
 *
 * Self-join authenticates with a real STUDENT JWT — either the browser
 * dev-testing `POST /auth/login` path (`useAuthStore`), or, on a real
 * seat, the JWT `POST /classroom/sign-in` mints when a student signs in
 * (`useStudentSession` — see StationsService.claim's doc comment).
 * `apiFetch` (lib/api-client.ts) falls back to the student session's
 * token when there's no dashboard login, so this panel only needs to
 * decide whether *some* STUDENT identity exists.
 */
export function JoinBatchPanel() {
  const dashboardUser = useAuthStore((s) => s.user);
  const student = useStudentSession((s) => s.student);
  const isStudent = dashboardUser?.role === 'STUDENT' || student !== null;
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: enrollments } = useQuery({
    queryKey: queryKeys.myEnrollments,
    queryFn: batchesApi.myEnrollments,
    enabled: isStudent,
  });

  const join = useMutation({
    mutationFn: () => batchesApi.join({ code, joinKey }),
    onSuccess: (res) => {
      setCode('');
      setJoinKey('');
      setError(null);
      setNotice(res.alreadyEnrolled ? `Already a member of ${res.batch.code}.` : `Joined ${res.batch.code}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myEnrollments });
    },
    onError: (err) => {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'Failed to join batch');
    },
  });

  if (!isStudent) return null;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">My Batches</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {enrollments && enrollments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {enrollments.map((e) => (
              <Badge key={e.batch.id} variant="outline">
                {e.batch.code} — {e.batch.name}
              </Badge>
            ))}
          </div>
        )}
        {enrollments?.length === 0 && <p className="text-xs text-muted-foreground">Not a member of any batch yet.</p>}

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label>Batch ID</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ACTC-B02" className="w-40" />
          </div>
          <div className="space-y-1.5">
            <Label>Batch Key</Label>
            <Input value={joinKey} onChange={(e) => setJoinKey(e.target.value)} placeholder="Given by your instructor" className="w-48" />
          </div>
          <Button onClick={() => join.mutate()} disabled={join.isPending || !code.trim() || !joinKey.trim()}>
            {join.isPending ? 'Joining…' : 'Join'}
          </Button>
        </div>
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
