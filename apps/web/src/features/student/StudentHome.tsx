import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, GraduationCap, Mic, School } from 'lucide-react';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import type { StudentSessionUser } from '../../stores/student-session-store';
import type { StudentSection } from './StudentDrawer';
import { useStudyLibrary } from './use-study-library';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A student's personalised landing screen — a greeting plus one summary
 * card per drawer section, each a shortcut into that section. Everything
 * here is read-only; the sections themselves own all actions.
 *
 * `active` is whether Home is the visible section. StudentConsole keeps
 * every section mounted (hidden) so an exercise in progress survives a
 * section switch, which means this component's queries would otherwise
 * never refetch after a student finishes an assignment elsewhere — so they
 * are refetched each time Home becomes visible again.
 */
export function StudentHome({
  control,
  student,
  seatText,
  liveClass,
  active,
  onNavigate,
}: {
  control: StationControlClient;
  student: StudentSessionUser;
  seatText: string | null;
  liveClass: { id: string; title: string; teacherName: string } | null;
  active: boolean;
  onNavigate: (section: StudentSection) => void;
}) {
  const classes = useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine });
  const assignments = useQuery({
    queryKey: queryKeys.studentAssignments,
    queryFn: () => stationApi.myAssignments(control.getToken()),
  });
  const library = useStudyLibrary(control, { active });

  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      void classes.refetch();
      void assignments.refetch();
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const todo = (assignments.data ?? []).filter((row) => !row.latestAttempt);
  const done = (assignments.data?.length ?? 0) - todo.length;
  const nextDue = todo
    .map((row) => row.assignment.dueAt)
    .filter((d): d is string => !!d)
    .sort()[0];
  const libraryModules = library.data?.modules ?? [];
  const moduleCount = libraryModules.length;
  const exerciseCount = libraryModules.reduce((n, m) => n + m.exercises.length, 0);
  // Files inside modules plus the loose ones the teacher shared on their own.
  const fileCount = libraryModules.reduce((n, m) => n + m.materials.length, 0) + (library.data?.files.length ?? 0);
  const classCount = classes.data?.length ?? 0;

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">
          {greeting()}, {firstName(student.fullName)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {student.serviceNumber}
          {seatText ? ` · ${seatText}` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <School className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Class</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {liveClass ? (
              <p className="text-sm">
                In class: <span className="font-medium">{liveClass.title}</span>
                <span className="block text-xs text-muted-foreground">{liveClass.teacherName}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not in a live class right now.</p>
            )}
            <p className="text-xs text-muted-foreground">
              {classes.isPending
                ? 'Loading your classes…'
                : classCount === 0
                  ? "You haven't joined a class yet."
                  : `Enrolled in ${classCount} ${classCount === 1 ? 'class' : 'classes'}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onNavigate('class')}>
                {liveClass ? 'Open class' : 'Join live class'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onNavigate('classes')}>
                My classes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Assignments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {assignments.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : assignments.isError ? (
              <p className="text-sm text-destructive">Could not load assignments.</p>
            ) : (
              <p className="text-sm">
                <span className="text-2xl font-semibold">{todo.length}</span> to do
                <span className="block text-xs text-muted-foreground">
                  {done} attempted
                  {nextDue ? ` · next due ${formatDue(nextDue)}` : ''}
                </span>
              </p>
            )}
            <Button size="sm" variant="secondary" onClick={() => onNavigate('assignments')}>
              View assignments
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Study Material</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {library.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : moduleCount === 0 && fileCount > 0 ? (
              <p className="text-sm">
                <span className="text-2xl font-semibold">{fileCount}</span> {fileCount === 1 ? 'file' : 'files'} to read
              </p>
            ) : (
              <p className="text-sm">
                <span className="text-2xl font-semibold">{moduleCount}</span> {moduleCount === 1 ? 'module' : 'modules'}
                <span className="block text-xs text-muted-foreground">
                  {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'} to practise
                  {fileCount > 0 && ` · ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to read`}
                </span>
              </p>
            )}
            <Button size="sm" variant="secondary" onClick={() => onNavigate('study')}>
              Open study material
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Pronunciation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Hear any word, record yourself and compare.</p>
            <Button size="sm" variant="secondary" onClick={() => onNavigate('pronunciation')}>
              Practise
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
