import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';
import { SessionComposer } from './sessions/SessionComposer';
import { SessionList } from './sessions/SessionList';
import { emptyGroup, type MemberCandidate } from './sessions/session-draft';

interface Batch {
  id: string;
  name: string;
}

/**
 * Teacher-facing composer for Annexure-I's "six independent, simultaneous
 * sessions" — the UI on top of the SessionsService state machine that
 * was built and verified live in the previous pass (create → arm →
 * start → pause → end, real LiveKit rooms per group). Picks SEATS across
 * any class; a class's own page (ClassActivitiesCard) picks its students.
 */
export function SessionBuilderPage() {
  const { data: batches } = useQuery({ queryKey: queryKeys.batches, queryFn: () => apiFetch<Batch[]>('/sessions/batches') });
  const { data: stations } = useQuery({
    queryKey: queryKeys.stationsStatusBoard,
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000,
  });

  const candidates: MemberCandidate[] = (stations ?? [])
    .filter((s) => s.seatNo && s.seatNo !== 1) // seat 1 is the teacher
    .map((s) => ({ key: s.stationId, stationId: s.stationId, label: `Seat ${seatLabel(s.seatNo)}`, detail: s.currentUser?.fullName }));

  // Seats a teacher already picked on the Lab Control Console, carried here
  // via navigation state so they don't have to re-pick them in MemberPicker.
  const preselected = (useLocation().state as { preselectedStationIds?: string[] } | null)?.preselectedStationIds;
  const initialGroups =
    preselected && preselected.length > 0 ? [{ ...emptyGroup(1, 'ROUND_TABLE'), memberStationIds: preselected }] : undefined;

  return (
    // No min-h-screen / dark wrapper: this page renders inside TeacherLayout's
    // <Outlet>, so a full-bleed dark background painted a black box in the
    // middle of the layout.
    <div className="text-foreground">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Session Builder</h1>
        <Link to="/dashboard" className="text-sm text-brand hover:underline">
          ← Lab Control Console
        </Link>
      </header>

      <section className="mb-8 rounded-card border border-hairline bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">New Session</h2>
        <SessionComposer batches={batches} candidates={candidates} emptyText="No stations online yet." initialGroups={initialGroups} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Sessions</h2>
        <SessionList />
      </section>
    </div>
  );
}
