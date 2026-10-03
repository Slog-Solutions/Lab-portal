import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Users2, XCircle } from 'lucide-react';
import { seatLabel } from '@lab/shared';
import { controlApi } from '../../lib/control-api';
import { stationsApi } from '../../lib/stations-api';
import { classroomApi } from '../../lib/classroom-api';
import { useAuthStore } from '../../stores/auth-store';
import { BroadcastPanel } from '../teacher/BroadcastPanel';
import { RemoteControlView } from '../teacher/RemoteControlView';
import { ScreenSpotlightPanel } from '../teacher/ScreenSpotlightPanel';
import { SessionList } from '../teacher/sessions/SessionList';
import { PageTitle } from '@/components/layout/PageTitle';
import { Panel } from '@/components/layout/Panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { STUDENT_SEATS, TOTAL_SEATS, useLabStatus } from './use-lab-status';
import { ClassSessionCard } from './class-control/ClassSessionCard';
import { ConfirmDialog, LaunchProgramDialog, MessageDialog, OpenUrlDialog } from './class-control/dialogs';
import { SeatGrid, SeatLegend } from './class-control/SeatGrid';
import { SeatInspector } from './class-control/SeatInspector';
import { SelectionBar, type BulkAction } from './class-control/SelectionBar';
import { UnclaimedStationsPanel } from './class-control/UnclaimedStations';

type Notice = { text: string; tone: 'ok' | 'error' };

/**
 * Class control — the operating console: run the class (start/end, join
 * code), broadcast and intercom, and act on seats. Seats are picked in the
 * grid (click, Shift+click for a range, or the quick-select buttons) and
 * acted on from the action bar that appears with a selection; the inspector
 * beside the grid shows the selected seat(s).
 */
export function ClassControlPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const lab = useLabStatus();
  const { data: currentClass, refetch: refetchClass } = useQuery({ queryKey: ['classroom', 'current'], queryFn: classroomApi.current });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [remoteControlTarget, setRemoteControlTarget] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ stationId: string; room: string; viewerToken: string; mic: boolean } | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [openUrlOpen, setOpenUrlOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'shutdown' | 'windows-lock'>(null);
  const lastClickedSeat = useRef<number | null>(null);

  // Drop selections for stations that disappeared from the board.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => lab.rows.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [lab.rows]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Esc clears the selection (unless a dialog or a field has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      setSelected(new Set());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedRows = selectedIds.map((id) => lab.rows.get(id)).filter((r) => r !== undefined);
  const target = { kind: 'stations' as const, stationIds: selectedIds };
  const studentIds = selectedIds.filter((id) => {
    const seatNo = lab.rows.get(id)?.seatNo;
    return seatNo != null && seatNo !== 1;
  });
  const studentTarget = { kind: 'stations' as const, stationIds: studentIds };

  const say = (text: string, tone: Notice['tone'] = 'ok') => setNotice({ text, tone });
  const errText = (err: unknown) => (err instanceof Error ? err.message : 'unknown error');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ---------------- selection ---------------- */

  function onSeatClick(stationId: string, seatNo: number | null, shift: boolean): void {
    if (shift && seatNo !== null && lastClickedSeat.current !== null) {
      const [lo, hi] = [Math.min(seatNo, lastClickedSeat.current), Math.max(seatNo, lastClickedSeat.current)];
      setSelected((prev) => {
        const next = new Set(prev);
        for (let n = lo; n <= hi; n++) {
          const s = lab.bySeat.get(n);
          if (s) next.add(s.stationId);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(stationId)) next.delete(stationId);
        else next.add(stationId);
        return next;
      });
    }
    if (seatNo !== null) lastClickedSeat.current = seatNo;
  }

  const numbered = lab.stations.filter((r) => r.seatNo !== null);
  const quickSelects = [
    { label: 'Online', ids: numbered.filter((r) => r.lifecycle !== 'OFFLINE' && r.lifecycle !== 'UNCLAIMED').map((r) => r.stationId) },
    { label: 'Seated students', ids: numbered.filter((r) => r.currentUser).map((r) => r.stationId) },
    { label: 'Locked', ids: numbered.filter((r) => r.lock || r.lifecycle === 'LOCKED').map((r) => r.stationId) },
    { label: 'Offline', ids: numbered.filter((r) => r.lifecycle === 'OFFLINE').map((r) => r.stationId) },
  ];

  /* ---------------- actions ---------------- */

  async function run(action: () => Promise<unknown>, success: string, failure: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      say(success);
      await lab.refetch();
    } catch (err) {
      say(`${failure}: ${errText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function onBulkAction(a: BulkAction): void {
    const n = selectedIds.length;
    switch (a) {
      case 'lock-screen':
        void run(
          () => controlApi.lock(target, { mode: 'soft', screen: true, input: true, message: 'Screen locked by instructor' }),
          `Locked ${plural(n, 'screen')}`,
          'Lock failed',
        );
        break;
      case 'lock-input':
        void run(
          () => controlApi.lock(studentTarget, { mode: 'soft', screen: false, input: true, message: 'Keyboard and mouse locked by instructor' }),
          `Locked keyboard & mouse on ${plural(studentIds.length, 'seat')}`,
          'Input lock failed',
        );
        break;
      case 'unlock':
        void run(() => controlApi.unlock(target), `Unlocked ${plural(n, 'seat')}`, 'Unlock failed');
        break;
      case 'wake':
        void run(() => controlApi.wake(target), `Wake signal sent to ${plural(n, 'PC')}`, 'Wake failed');
        break;
      case 'restart':
        void run(() => controlApi.restart(target), `Restarting ${plural(n, 'PC')}`, 'Restart failed');
        break;
      case 'disable':
        void run(() => controlApi.disable(target), `Disabled ${plural(n, 'console')}`, 'Disable failed');
        break;
      case 'enable':
        void run(() => controlApi.enable(target), `Enabled ${plural(n, 'console')}`, 'Enable failed');
        break;
      case 'message':
        setMessageOpen(true);
        break;
      case 'open-url':
        setOpenUrlOpen(true);
        break;
      case 'launch-program':
        setLaunchOpen(true);
        break;
      case 'shutdown':
      case 'windows-lock':
        setConfirm(a);
        break;
    }
  }

  async function handleShareToClass(stationId: string, mic: boolean): Promise<void> {
    try {
      const { room, viewerToken } = await controlApi.promoteScreen(stationId, mic);
      setSpotlight({ stationId, room, viewerToken, mic });
      say('Sharing screen with the class');
      await lab.refetch();
    } catch (err) {
      say(`Share to class failed: ${errText(err)}`, 'error');
    }
  }

  async function handleStopSharing(stationId: string): Promise<void> {
    try {
      await controlApi.revokeScreen(stationId);
      setSpotlight((prev) => (prev?.stationId === stationId ? null : prev));
      say('Stopped sharing');
      await lab.refetch();
    } catch (err) {
      say(`Stop sharing failed: ${errText(err)}`, 'error');
    }
  }

  async function handleAssignSeat(stationId: string, seatNo: number): Promise<void> {
    setAssigningId(stationId);
    try {
      await stationsApi.assignSeat({ stationId, seatNo });
      say(`Assigned seat ${seatLabel(seatNo)}`);
      await lab.refetch();
    } catch (err) {
      say(`Assign seat failed: ${errText(err)}`, 'error');
    } finally {
      setAssigningId(null);
    }
  }

  async function handleChangeSeat(stationId: string, seatNo: number): Promise<void> {
    try {
      const res = await stationsApi.changeSeat(stationId, seatNo);
      say(res.swappedWithStationId ? `Swapped — this PC is now seat ${seatLabel(seatNo)}` : `Moved to seat ${seatLabel(seatNo)}`);
      await lab.refetch();
    } catch (err) {
      say(`Change seat failed: ${errText(err)}`, 'error');
      throw err; // keeps the inspector's picker open so the admin can retry
    }
  }

  function handleCreateActivity(): void {
    navigate('/sessions', { state: { preselectedStationIds: studentIds } });
  }

  const classLive = currentClass?.state === 'ACTIVE';

  return (
    <div>
      <PageTitle
        title="Class control"
        subtitle="Run the class, broadcast, and control student consoles"
        breadcrumbs={[{ label: 'Lab control', to: '/dashboard' }, { label: 'Class control' }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/sessions">
              <Users2 />
              Session builder
            </Link>
          </Button>
        }
      />

      {/* Run the class */}
      <div className="grid grid-cols-1 gap-grid-gap xl:grid-cols-12">
        <div className="xl:col-span-5">
          <ClassSessionCard
            currentClass={currentClass ?? null}
            isAdmin={isAdmin}
            seatedCount={lab.seatedCount}
            studentSeats={STUDENT_SEATS}
            onStart={async (title) => {
              try {
                await classroomApi.start({ title: title || undefined });
                await Promise.all([refetchClass(), lab.refetch()]);
                say('Class started');
              } catch (err) {
                say(`Could not start the class: ${errText(err)}`, 'error');
              }
            }}
            onEnd={async () => {
              if (!currentClass) return;
              try {
                await classroomApi.end(currentClass.id);
                await Promise.all([refetchClass(), lab.refetch()]);
                say('Class ended — students signed out');
              } catch (err) {
                say(`Could not end the class: ${errText(err)}`, 'error');
              }
            }}
          />
        </div>
        <div className="xl:col-span-7">
          <BroadcastPanel isAdmin={isAdmin} classId={currentClass?.id ?? null} />
        </div>
      </div>

      {/* Seats */}
      <Panel
        className="mt-grid-gap"
        title="Seats"
        description={`${TOTAL_SEATS} consoles · ${lab.onlineCount} online · ${lab.seatedCount} seated${classLive ? '' : ' · no class running'}`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick select">
            <span className="mr-1 text-xs text-muted-foreground">Select:</span>
            {quickSelects.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={q.ids.length === 0}
                onClick={() => setSelected(new Set(q.ids))}
                className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-input bg-card px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {q.label}
                <span className="rounded-pill bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{q.ids.length}</span>
              </button>
            ))}
          </div>
        }
      >
        <SeatLegend />

        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          {/* The action bar lives in the grid's column so, while it sticks to
              the viewport bottom, it can never cover the inspector's buttons. */}
          <div className="min-w-0">
            <SeatGrid bySeat={lab.bySeat} unclaimed={lab.unclaimed} selected={selected} isAdmin={isAdmin} onSeatClick={onSeatClick} />
            {selectedIds.length > 0 && (
              <SelectionBar
                count={selectedIds.length}
                studentCount={studentIds.length}
                busy={busy}
                onAction={onBulkAction}
                onCreateActivity={handleCreateActivity}
                onClear={() => setSelected(new Set())}
              />
            )}
          </div>
          <aside className="xl:sticky xl:top-[86px] xl:self-start">
            <SeatInspector
              selected={selectedRows}
              isAdmin={isAdmin}
              onTakeRemoteControl={setRemoteControlTarget}
              onShareToClass={(id) => void handleShareToClass(id, false)}
              onStopSharing={(id) => void handleStopSharing(id)}
              bySeat={lab.bySeat}
              onChangeSeat={isAdmin ? handleChangeSeat : undefined}
              onReleaseStudent={async (id) => {
                try {
                  await classroomApi.releaseStudent(id);
                  say('Released student from seat');
                  await lab.refetch();
                } catch (err) {
                  say(`Release failed: ${errText(err)}`, 'error');
                }
              }}
            />
          </aside>
        </div>

        {isAdmin && (
          <UnclaimedStationsPanel stations={lab.unclaimed} freeSeats={lab.freeSeats} assigningId={assigningId} onAssign={handleAssignSeat} />
        )}
      </Panel>

      <Panel
        className="mt-grid-gap"
        title="Ongoing activities"
        description="Group sessions running now"
        actions={
          <Link to="/sessions" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
            Manage sessions
            <ArrowRight className="h-3 w-3" />
          </Link>
        }
      >
        <SessionList onlyActive emptyText="No ongoing activities — select seats and choose Create activity to start one." />
      </Panel>

      {/* Dialogs and overlays */}
      <MessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        recipientCount={selectedIds.length}
        onSend={(text, severity) => run(() => controlApi.message(target, text, severity), `Message sent to ${plural(selectedIds.length, 'console')}`, 'Message failed')}
      />
      <OpenUrlDialog
        open={openUrlOpen}
        onOpenChange={setOpenUrlOpen}
        recipientCount={selectedIds.length}
        onOpen={(url) => run(() => controlApi.openUrl(target, url), `Opening website on ${plural(selectedIds.length, 'console')}`, 'Open website failed')}
      />
      <LaunchProgramDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        recipientCount={selectedIds.length}
        onLaunch={(id, label) => run(() => controlApi.launchProgram(target, id), `Launching ${label} on ${plural(selectedIds.length, 'console')}`, 'Launch failed')}
      />
      <ConfirmDialog
        open={confirm === 'shutdown'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Shut down ${plural(selectedIds.length, 'PC')}?`}
        description="Any unsaved student work on those PCs will be lost. They can be powered back on with Wake."
        confirmLabel="Shut down"
        destructive
        onConfirm={() => run(() => controlApi.shutdown(target), `Shutting down ${plural(selectedIds.length, 'PC')}`, 'Shutdown failed')}
      />
      <ConfirmDialog
        open={confirm === 'windows-lock'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Windows-lock ${plural(selectedIds.length, 'PC')}?`}
        description="This is a real Windows lock (Win+L). Only the student’s own Windows password releases it — Unlock here will not."
        confirmLabel="Windows-lock"
        onConfirm={() =>
          run(
            () => controlApi.lock(target, { mode: 'windows', screen: true, input: true, message: 'Screen locked by instructor' }),
            `Windows-locked ${plural(selectedIds.length, 'PC')}`,
            'Windows lock failed',
          )
        }
      />

      {remoteControlTarget && <RemoteControlView stationId={remoteControlTarget} onClose={() => setRemoteControlTarget(null)} />}
      {spotlight && (
        <ScreenSpotlightPanel
          stationId={spotlight.stationId}
          seatNo={lab.rows.get(spotlight.stationId)?.seatNo ?? null}
          room={spotlight.room}
          viewerToken={spotlight.viewerToken}
          mic={spotlight.mic}
          onMicToggle={() => void handleShareToClass(spotlight.stationId, !spotlight.mic)}
          onStop={() => void handleStopSharing(spotlight.stationId)}
        />
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            'fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-2.5 rounded-control border bg-card px-4 py-3 text-sm',
            notice.tone === 'error' ? 'border-destructive/40 text-destructive' : 'border-status-online/40 text-foreground',
          )}
        >
          {notice.tone === 'error' ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-online" />
          )}
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
}
