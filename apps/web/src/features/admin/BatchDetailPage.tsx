import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { batchesApi } from '../../lib/batches-api';
import { usersApi } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { UserRole } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** Assign teachers to a batch (enforced server-side — a teacher with no
 * row here cannot create/run a session against this batch) and manage
 * the enrolled student roster. */
export function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const batchId = id!;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: batch, isLoading } = useQuery({ queryKey: queryKeys.adminBatch(batchId), queryFn: () => batchesApi.get(batchId) });
  const { data: students } = useQuery({ queryKey: queryKeys.adminBatchStudents(batchId), queryFn: () => batchesApi.listStudents(batchId) });
  const { data: allTeachers, isError: teachersError } = useQuery({ queryKey: queryKeys.users('TEACHER'), queryFn: () => usersApi.list(UserRole.TEACHER) });
  const { data: allStudents, isError: studentsError } = useQuery({ queryKey: queryKeys.users('STUDENT'), queryFn: () => usersApi.list(UserRole.STUDENT) });

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [joinOpen, setJoinOpen] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [pickedTeachers, setPickedTeachers] = useState<Set<string>>(new Set());
  const [assignError, setAssignError] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [pickedStudents, setPickedStudents] = useState<Set<string>>(new Set());
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function invalidateAll(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminBatch(batchId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminBatchStudents(batchId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminBatches });
  }

  const openEdit = useMutation({
    mutationFn: () => batchesApi.update(batchId, { name, code, joinKey, joinOpen }),
    onSuccess: () => {
      setEditOpen(false);
      setEditError(null);
      invalidateAll();
    },
    onError: (err) => setEditError(err instanceof Error ? err.message : 'Failed to update batch'),
  });

  const assignTeachers = useMutation({
    mutationFn: () => batchesApi.assignTeachers(batchId, Array.from(pickedTeachers)),
    onSuccess: () => {
      setAssignOpen(false);
      setPickedTeachers(new Set());
      setAssignError(null);
      invalidateAll();
    },
    onError: (err) => setAssignError(err instanceof Error ? err.message : 'Failed to assign teachers'),
  });
  const unassignTeacher = useMutation({
    mutationFn: (teacherId: string) => batchesApi.unassignTeacher(batchId, teacherId),
    onSuccess: invalidateAll,
  });

  const enrollStudents = useMutation({
    mutationFn: () => batchesApi.enrollStudents(batchId, Array.from(pickedStudents)),
    onSuccess: () => {
      setEnrollOpen(false);
      setPickedStudents(new Set());
      setEnrollError(null);
      invalidateAll();
    },
    onError: (err) => setEnrollError(err instanceof Error ? err.message : 'Failed to enrol students'),
  });
  const unenrollStudent = useMutation({
    mutationFn: (studentId: string) => batchesApi.unenrollStudent(batchId, studentId),
    onSuccess: invalidateAll,
  });

  const deleteBatch = useMutation({
    mutationFn: () => batchesApi.remove(batchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBatches });
      navigate('/admin/batches');
    },
    onError: (err) => setDeleteError(err instanceof Error ? err.message : 'Failed to delete batch'),
  });

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string): void {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  const assignedTeacherIds = new Set(batch?.teachers.map((t) => t.teacherId));
  const enrolledStudentIds = new Set(students?.map((s) => s.userId));
  const assignableTeachers = allTeachers?.filter((t) => !assignedTeacherIds.has(t.id)) ?? [];
  const enrollableStudents = allStudents?.filter((s) => !enrolledStudentIds.has(s.id)) ?? [];

  if (isLoading || !batch) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {batch.code} — {batch.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Batch key: <span className="font-mono">{batch.joinKey}</span> ·{' '}
            <Badge variant={batch.joinOpen ? 'success' : 'secondary'}>{batch.joinOpen ? 'Joining open' : 'Joining closed'}</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog
            open={editOpen}
            onOpenChange={(v) => {
              setEditOpen(v);
              if (v) {
                setName(batch.name);
                setCode(batch.code);
                setJoinKey(batch.joinKey ?? '');
                setJoinOpen(batch.joinOpen);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">Edit Batch</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Batch</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Batch ID</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Batch Key</Label>
                  <Input value={joinKey} onChange={(e) => setJoinKey(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={joinOpen} onCheckedChange={(v) => setJoinOpen(v === true)} />
                  Accept new self-joins
                </label>
                {editError && <p className="text-sm text-destructive">{editError}</p>}
              </div>
              <DialogFooter>
                <Button onClick={() => openEdit.mutate()} disabled={openEdit.isPending || !name.trim() || !code.trim() || !joinKey.trim()}>
                  {openEdit.isPending ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setDeleteError(null); }}>
            <DialogTrigger asChild>
              <Button variant="destructive">Delete Batch</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {batch.code}?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This removes the batch, its teacher assignments and student enrollments. A batch with any class
                sessions cannot be deleted.
              </p>
              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
              <DialogFooter>
                <Button variant="destructive" onClick={() => deleteBatch.mutate()} disabled={deleteBatch.isPending}>
                  {deleteBatch.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Teachers</CardTitle>
          <Dialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) setAssignError(null); }}>
            <DialogTrigger asChild>
              <Button size="sm">Assign teachers</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign teachers to {batch.code}</DialogTitle>
              </DialogHeader>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {assignableTeachers.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                    <Checkbox checked={pickedTeachers.has(t.id)} onCheckedChange={() => toggle(pickedTeachers, setPickedTeachers, t.id)} />
                    <span className="flex-1">{t.fullName}</span>
                    <span className="text-xs text-muted-foreground">{t.serviceNumber}</span>
                  </label>
                ))}
                {teachersError && (
                  <p className="p-1.5 text-xs text-destructive">Couldn't load the teacher list — try reopening this dialog.</p>
                )}
                {!teachersError && assignableTeachers.length === 0 && (
                  <p className="p-1.5 text-xs text-muted-foreground">All teachers are already assigned.</p>
                )}
              </div>
              {assignError && <p className="text-sm text-destructive">{assignError}</p>}
              <DialogFooter>
                <Button onClick={() => assignTeachers.mutate()} disabled={assignTeachers.isPending || pickedTeachers.size === 0}>
                  {assignTeachers.isPending ? 'Assigning…' : 'Assign'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Service No.</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.teachers.map((t) => (
                <TableRow key={t.teacherId}>
                  <TableCell>{t.teacher.fullName}</TableCell>
                  <TableCell>{t.teacher.serviceNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(t.assignedAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => unassignTeacher.mutate(t.teacherId)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {batch.teachers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No teacher assigned yet — this batch is invisible to every teacher until you assign one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Students</CardTitle>
          <Dialog open={enrollOpen} onOpenChange={(v) => { setEnrollOpen(v); if (!v) setEnrollError(null); }}>
            <DialogTrigger asChild>
              <Button size="sm">Enrol students</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enrol students in {batch.code}</DialogTitle>
              </DialogHeader>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {enrollableStudents.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                    <Checkbox checked={pickedStudents.has(s.id)} onCheckedChange={() => toggle(pickedStudents, setPickedStudents, s.id)} />
                    <span className="flex-1">{s.fullName}</span>
                    <span className="text-xs text-muted-foreground">{s.serviceNumber}</span>
                  </label>
                ))}
                {studentsError && (
                  <p className="p-1.5 text-xs text-destructive">Couldn't load the student list — try reopening this dialog.</p>
                )}
                {!studentsError && enrollableStudents.length === 0 && (
                  <p className="p-1.5 text-xs text-muted-foreground">All students are already enrolled.</p>
                )}
              </div>
              {enrollError && <p className="text-sm text-destructive">{enrollError}</p>}
              <DialogFooter>
                <Button onClick={() => enrollStudents.mutate()} disabled={enrollStudents.isPending || pickedStudents.size === 0}>
                  {enrollStudents.isPending ? 'Enrolling…' : 'Enrol'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Service No.</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {students?.map((s) => (
                <TableRow key={s.userId}>
                  <TableCell>{s.user.fullName}</TableCell>
                  <TableCell>{s.user.serviceNumber}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.source === 'SELF_JOIN' ? 'Self-joined' : 'Admin'}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(s.enrolledAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => unenrollStudent.mutate(s.userId)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {students?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No students enrolled yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
