import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { batchesApi, type EnrolledStudent } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { ASSIGNMENT_KINDS } from '../assignments/assignment-kinds';
import { ClassActivitiesCard } from './ClassActivitiesCard';
import { LiveClassCard } from './LiveClassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * One class the teacher teaches: its code and join key (each with a copy
 * button — the key is meant to be read out to the room), the roster, and the
 * controls a teacher is allowed — rename, open/close joining, rotate the key,
 * remove a student. Never the code itself and never delete: those stay with
 * the admin (BatchesService.update / the ADMIN-only DELETE route).
 *
 * The class comes from GET /batches/mine rather than GET /batches/:id, which
 * is ADMIN-only; "mine" is also what carries the join key for a teacher.
 */
export function ClassDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: classes, isLoading } = useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine });
  const cls = classes?.find((c) => c.id === id);
  const { data: roster } = useQuery({
    queryKey: queryKeys.classStudents(id),
    queryFn: () => batchesApi.listStudents(id),
    enabled: !!cls,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [removing, setRemoving] = useState<EnrolledStudent | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refreshClasses(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.myClasses });
    void queryClient.invalidateQueries({ queryKey: queryKeys.batches });
  }

  const update = useMutation({
    mutationFn: (patch: { name?: string; joinOpen?: boolean }) => batchesApi.update(id, patch),
    onSuccess: () => {
      setRenameOpen(false);
      setError(null);
      refreshClasses();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to update the class'),
  });

  const regenerate = useMutation({
    mutationFn: () => batchesApi.regenerateKey(id),
    onSuccess: () => {
      setRegenOpen(false);
      setError(null);
      refreshClasses();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to regenerate the key'),
  });

  const removeStudent = useMutation({
    mutationFn: (studentId: string) => batchesApi.unenrollStudent(id, studentId),
    onSuccess: () => {
      setRemoving(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.classStudents(id) });
      refreshClasses();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to remove the student'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!cls) {
    return (
      <div className="space-y-3">
        <Link to="/classes" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> My classes
        </Link>
        <p className="text-sm text-muted-foreground">That class was not found, or you don't teach it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/classes" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> My classes
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{cls.name}</h1>
          <Button
            variant="outline"
            onClick={() => {
              setNewName(cls.name);
              setError(null);
              setRenameOpen(true);
            }}
          >
            Rename
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Joining</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Class code</span>
            <span className="font-mono text-sm">{cls.code}</span>
            <CopyButton value={cls.code} label="class code" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-xs text-muted-foreground">Join key</span>
            <span className="font-mono text-sm">{cls.joinKey ?? '—'}</span>
            {cls.joinKey && <CopyButton value={cls.joinKey} label="join key" />}
            <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Regenerate key
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={cls.joinOpen}
              disabled={update.isPending}
              onCheckedChange={(v) => update.mutate({ joinOpen: v === true })}
            />
            Accept new students
            <Badge variant={cls.joinOpen ? 'success' : 'secondary'}>{cls.joinOpen ? 'Open' : 'Closed'}</Badge>
          </label>
        </CardContent>
      </Card>

      <LiveClassCard classId={id} batchName={cls.name} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Assignment</CardTitle>
          <CardDescription>Create an assignment for students in this class.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {ASSIGNMENT_KINDS.map(({ slug, label, icon: Icon, description }) => (
              <Link
                key={slug}
                to={`/assignments/${slug}?classId=${id}`}
                className="group flex flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:border-primary hover:bg-accent/50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <ClassActivitiesCard classId={id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Students ({cls.studentCount})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service no.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster?.map((s) => (
                <TableRow key={s.userId}>
                  <TableCell className="font-mono text-xs">{s.user.serviceNumber}</TableCell>
                  <TableCell>{s.user.fullName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(s.enrolledAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setRemoving(s);
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {roster?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No students yet. Share the class code and join key.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename class</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rename-class">Name</Label>
            <Input id="rename-class" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              onClick={() => update.mutate({ name: newName.trim() })}
              disabled={update.isPending || !newName.trim() || newName.trim() === cls.name}
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate the join key?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The old key stops working immediately. Students who have already joined are not affected — only people who
            still need to join will need the new key.
          </p>
          <DialogFooter>
            <Button onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
              {regenerate.isPending ? 'Regenerating…' : 'Regenerate key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.user.fullName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            They leave this class. If joining is open they can rejoin with the class code and join key.
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={() => removing && removeStudent.mutate(removing.userId)} disabled={removeStudent.isPending}>
              {removeStudent.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
