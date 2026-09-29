import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '@/components/layout/PageTitle';
import { Panel } from '@/components/layout/Panel';
import { Button } from '@/components/ui/button';
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
      <PageTitle
        title="Sessions"
        subtitle="Run up to six group activities side by side — pick the seats, then arm and start"
        breadcrumbs={[{ label: 'Lab control', to: '/dashboard' }, { label: 'Sessions' }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">
              <ArrowLeft />
              Lab control
            </Link>
          </Button>
        }
      />

      <div className="space-y-grid-gap">
        <Panel title="New session" description="Name it, choose the class, then set up each group">
          <SessionComposer batches={batches} candidates={candidates} emptyText="No stations online yet." initialGroups={initialGroups} />
        </Panel>

        <Panel title="All sessions" description="Arm, start, pause and end sessions; listen in on any group">
          <SessionList />
        </Panel>
      </div>
    </div>
  );
}
