import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@lab/shared';
import { CheckCircle2 } from 'lucide-react';
import { batchesApi } from '../../lib/batches-api';
import { usersApi, type UserRow } from '../../lib/users-api';
import { gradebookApi } from '../../lib/gradebook-api';
import { queryKeys } from '../../lib/query-keys';
import { StudentPicker } from './StudentPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix &lt;Select&gt; reserves value="" for "cleared" — this sentinel stands
 * in for "no class filter, show every student". */
const ALL_STUDENTS = '__all__';

/** Hand a saved PRONUNCIATION exercise to students, optionally filtered to
 * one class — the assign action the "Your Pronunciation Exercises" table
 * promised but never had. Reuses the same class-filter shape as
 * CreateAssignmentPage's ?classId flow and the same StudentPicker +
 * "already assigned" tagging PronunciationTestResultsPage's "Send to more
 * students" uses. `exercise: null` keeps the dialog mounted but closed, so
 * its queries can be `enabled` off cleanly between opens. */
export function AssignPronunciationDialog({
  exercise,
  onClose,
}: {
  exercise: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [autoSelected, setAutoSelected] = useState(false);

  const exerciseId = exercise?.id;

  useEffect(() => {
    // A different exercise (or a fresh open of the same one after closing)
    // starts from a clean form.
    setClassId('');
    setSelected([]);
    setDueDate('');
    setAutoSelected(false);
  }, [exerciseId]);

  const { data: myClasses } = useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine, enabled: Boolean(exerciseId) });
  const { data: allStudents } = useQuery({
    queryKey: queryKeys.users(UserRole.STUDENT),
    queryFn: () => usersApi.list(UserRole.STUDENT),
    enabled: Boolean(exerciseId) && !classId,
  });
  const { data: classStudents, isLoading: classStudentsLoading } = useQuery({
    queryKey: queryKeys.classStudents(classId),
    queryFn: () => batchesApi.listStudents(classId),
    enabled: Boolean(exerciseId) && Boolean(classId),
  });
  // Who already has this exercise, so the picker can flag them instead of
  // silently letting a re-send create a duplicate the server would skip anyway.
  const { data: existingAssignments } = useQuery({
    queryKey: queryKeys.gradebookAssignments({ exerciseId }),
    queryFn: () => gradebookApi.listAssignments({ exerciseId }),
    enabled: Boolean(exerciseId),
  });

  const classStudentRows: UserRow[] = (classStudents ?? [])
    .filter((s) => s.user.active)
    .map((s) => ({ id: s.userId, serviceNumber: s.user.serviceNumber, fullName: s.user.fullName, role: 'STUDENT' as const, rank: null, active: true }));
  const activeStudents = classId ? classStudentRows : (allStudents ?? []).filter((s) => s.active);

  // Auto-select everyone in the chosen class, once, the same way
  // CreateAssignmentPage does for a class-linked assignment.
  useEffect(() => {
    if (classId && classStudentRows.length > 0 && !autoSelected) {
      setSelected(classStudentRows.map((s) => s.id));
      setAutoSelected(true);
    }
  }, [classId, classStudentRows.length, autoSelected]);

  function tagFor(student: UserRow): string | null {
    const mine = (existingAssignments ?? []).filter((a) => a.studentId === student.id);
    if (mine.length === 0) return null;
    const outstanding = mine.some((a) => !a.attempts.some((t) => t.status === 'SUBMITTED' || t.status === 'SCORED'));
    return outstanding ? 'already assigned' : 'already submitted';
  }

  const assign = useMutation({
    mutationFn: () =>
      gradebookApi.createAssignments({
        studentIds: selected,
        exerciseIds: [exerciseId!],
        batchId: classId || undefined,
        dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pronunciationExercises });
      void queryClient.invalidateQueries({ queryKey: queryKeys.gradebookAssignments({ exerciseId }) });
      setSelected([]);
    },
  });

  return (
    <Dialog open={Boolean(exercise)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {exercise && (
          <>
            <DialogHeader>
              <DialogTitle>Assign — {exercise.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="assign-class">Class (optional)</Label>
                <Select
                  value={classId || ALL_STUDENTS}
                  onValueChange={(v) => {
                    setClassId(v === ALL_STUDENTS ? '' : v);
                    setSelected([]);
                    setAutoSelected(false);
                  }}
                >
                  <SelectTrigger id="assign-class">
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
                <StudentPicker students={activeStudents} selected={selected} onChange={setSelected} tag={tagFor} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="assign-due">Due date (optional)</Label>
                <Input id="assign-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
              </div>

              {assign.isError && <p className="text-sm text-destructive">{assign.error instanceof Error ? assign.error.message : 'Could not assign'}</p>}
              {assign.isSuccess && assign.data && (
                <p className="flex items-center gap-1.5 text-sm text-status-online">
                  <CheckCircle2 className="h-4 w-4" />
                  Sent to {assign.data.created} {assign.data.created === 1 ? 'student' : 'students'}.
                  {assign.data.skipped > 0 && ` ${assign.data.skipped} already had it.`}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button disabled={selected.length === 0 || assign.isPending} onClick={() => assign.mutate()}>
                {assign.isPending ? 'Sending…' : `Send to ${selected.length} ${selected.length === 1 ? 'student' : 'students'}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
