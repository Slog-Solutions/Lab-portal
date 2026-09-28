import { useQuery } from '@tanstack/react-query';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { batchesApi } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SessionComposer } from './sessions/SessionComposer';
import { SessionList } from './sessions/SessionList';
import type { BuilderActivityType, MemberCandidate } from './sessions/session-draft';

/** Live activities a class runs here. A vocabulary test is set from this
 * page's "Create Assignment" instead — that one is scored and kept. */
const CLASS_ACTIVITY_TYPES: BuilderActivityType[] = ['ROUND_TABLE', 'TELEPHONE', 'MODEL_IMITATION', 'CONFERENCE_INTERPRETING'];

/**
 * A class's own live activities: the Session Builder with this class fixed
 * and its STUDENTS to pick instead of seats, plus this class's sessions to
 * run and review. An activity is delivered to the computer a student is
 * signed in at, so only students signed in right now can be picked; the
 * rest of the roster is listed greyed out. Everything a student does here
 * shows in their "My Classes" history.
 */
export function ClassActivitiesCard({ classId }: { classId: string }) {
  const { data: roster } = useQuery({ queryKey: queryKeys.classStudents(classId), queryFn: () => batchesApi.listStudents(classId) });
  const { data: stations } = useQuery({
    queryKey: queryKeys.stationsStatusBoard,
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000,
  });

  const candidates: MemberCandidate[] = (roster ?? [])
    .filter((s) => s.user.active)
    .map((s) => {
      // Seat 1 is the teacher's own PC — never a student seat.
      const seat = (stations ?? []).find((row) => row.currentUser?.id === s.userId && row.seatNo !== 1);
      return seat
        ? { key: s.userId, stationId: seat.stationId, studentId: s.userId, label: s.user.fullName, detail: `System ${seatLabel(seat.seatNo)}` }
        : { key: s.userId, stationId: null, label: s.user.fullName, disabledReason: 'Not at a PC' };
    })
    // Signed-in students first, then alphabetical.
    .sort((a, b) => Number(!a.stationId) - Number(!b.stationId) || a.label.localeCompare(b.label));
  const signedIn = candidates.filter((c) => c.stationId).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Class Activities</CardTitle>
        <CardDescription>
          Run a Round Table, Telephone, Model Imitation or Conference Interpreting activity with students from this class. Only
          students signed in at a PC can be picked ({signedIn} of {candidates.length} right now).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SessionComposer
          batchId={classId}
          candidates={candidates}
          activityTypes={CLASS_ACTIVITY_TYPES}
          emptyText="No students in this class yet."
        />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Activities in this class</h3>
          <SessionList batchId={classId} emptyText="No activities in this class yet." />
        </div>
      </CardContent>
    </Card>
  );
}
