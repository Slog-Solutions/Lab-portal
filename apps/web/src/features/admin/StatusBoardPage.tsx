import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { controlApi } from '../../lib/control-api';
import { stationsApi } from '../../lib/stations-api';
import { classroomApi, type ClassView } from '../../lib/classroom-api';
import { getControlSocket } from '../../lib/socket-client';
import { useAuthStore } from '../../stores/auth-store';
import { BroadcastPanel } from '../teacher/BroadcastPanel';
import { RemoteControlView } from '../teacher/RemoteControlView';
import { ScreenSpotlightPanel } from '../teacher/ScreenSpotlightPanel';
import { SessionList } from '../teacher/sessions/SessionList';
import {
  BentoCard,
  HeroCard,
  DarkStatCard,
  BigNumberCard,
  CalendarStripCard,
} from '@/components/bento';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Users2,
  Monitor,
  Lock,
  Unlock,
  Keyboard,
  MessageSquare,
  Zap,
  RotateCcw,
  Power,
  ShieldAlert,
  ArrowRight,
  Tv,
} from 'lucide-react';

const TOTAL_SEATS = 41; // Annexure-I: 1 teacher + 40 student stations

export function StatusBoardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: initial, refetch } = useQuery({
    queryKey: ['stations', 'status-board'],
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000,
  });
  const isAdmin = user?.role === 'ADMIN';
  const viewerIsTeacher = user?.role === 'TEACHER';
  const { data: currentClass, refetch: refetchClass } = useQuery({
    queryKey: ['classroom', 'current'],
    queryFn: classroomApi.current,
    enabled: viewerIsTeacher || isAdmin,
  });

  const [rows, setRows] = useState<Map<string, StationStatusRow>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [remoteControlTarget, setRemoteControlTarget] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ stationId: string; room: string; viewerToken: string; mic: boolean } | null>(null);
  const [classTitleInput, setClassTitleInput] = useState('');
  const [classActionBusy, setClassActionBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setRows(new Map(initial.map((r) => [r.stationId, r])));
  }, [initial]);

  useEffect(() => {
    const socket = getControlSocket();
    const onFull = (list: StationStatusRow[]) => setRows(new Map(list.map((r) => [r.stationId, r])));
    const onDelta = (patch: Partial<StationStatusRow> & { stationId: string }) =>
      setRows((prev) => {
        const next = new Map(prev);
        const existing = next.get(patch.stationId);
        next.set(patch.stationId, { ...(existing as StationStatusRow), ...patch });
        return next;
      });
    socket.on('lab:status', onFull);
    socket.on('lab:status:delta', onDelta);
    return () => {
      socket.off('lab:status', onFull);
      socket.off('lab:status:delta', onDelta);
    };
  }, []);

  const bySeat = new Map(Array.from(rows.values()).map((r) => [r.seatNo, r]));
  const onlineCount = Array.from(rows.values()).filter((r) => r.lifecycle !== 'OFFLINE').length;
  const seatedCount = Array.from(rows.values()).filter((r) => r.currentUser).length;

  const unclaimedStations = Array.from(rows.values()).filter((r) => r.seatNo === null);
  const takenSeats = new Set(Array.from(rows.values(), (r) => r.seatNo).filter((n): n is number => n !== null));
  const freeSeats = Array.from({ length: TOTAL_SEATS }, (_, i) => i + 1).filter((n) => !takenSeats.has(n));

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const target = { kind: 'stations' as const, stationIds: selectedIds };
  const studentTarget = useMemo(
    () => ({
      kind: 'stations' as const,
      stationIds: selectedIds.filter((id) => {
        const seatNo = rows.get(id)?.seatNo;
        return seatNo != null && seatNo !== 1;
      }),
    }),
    [selectedIds, rows],
  );

  async function handleAssignSeat(stationId: string, seatNo: number): Promise<void> {
    setAssigningId(stationId);
    setLastAction(null);
    try {
      await stationsApi.assignSeat({ stationId, seatNo });
      setLastAction(`Assigned seat ${seatNo}`);
      await refetch();
    } catch (err) {
      setLastAction(`Assign seat failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setAssigningId(null);
    }
  }

  async function handleShareToClass(stationId: string, mic: boolean): Promise<void> {
    setLastAction(null);
    try {
      const { room, viewerToken } = await controlApi.promoteScreen(stationId, mic);
      setSpotlight({ stationId, room, viewerToken, mic });
      setLastAction('Sharing screen with the class');
      await refetch();
    } catch (err) {
      setLastAction(`Share to class failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  async function handleStopSharing(stationId: string): Promise<void> {
    setLastAction(null);
    try {
      await controlApi.revokeScreen(stationId);
      setSpotlight((prev) => (prev?.stationId === stationId ? null : prev));
      setLastAction('Stopped sharing');
      await refetch();
    } catch (err) {
      setLastAction(`Stop sharing failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function toggleSeat(stationId: string | undefined): void {
    if (!stationId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  }

  function handleCreateActivity(): void {
    const stationIds = selectedIds.filter((id) => {
      const seatNo = rows.get(id)?.seatNo;
      return seatNo != null && seatNo !== 1;
    });
    navigate('/sessions', { state: { preselectedStationIds: stationIds } });
  }

  async function runAction(label: string, action: () => Promise<unknown>, successMessage?: string): Promise<void> {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setLastAction(null);
    try {
      await action();
      setLastAction(successMessage ?? `${label}: ${selectedIds.length} station(s)`);
      await refetch();
    } catch (err) {
      setLastAction(`${label} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleClass(): Promise<void> {
    setClassActionBusy(true);
    try {
      if (currentClass && currentClass.state === 'ACTIVE') {
        const count = currentClass.memberCount;
        if (window.confirm(`This signs out all ${count} student${count === 1 ? '' : 's'}. End class?`)) {
          await classroomApi.end(currentClass.id);
          await refetchClass();
          await refetch();
        }
      } else {
        await classroomApi.start({ title: classTitleInput.trim() || undefined });
        setClassTitleInput('');
        await refetchClass();
        await refetch();
      }
    } catch (err) {
      setLastAction(`Class action failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setClassActionBusy(false);
    }
  }

  const seatedPercent = Math.round((seatedCount / Math.max(1, TOTAL_SEATS - 1)) * 100);
  const onlinePercent = Math.round((onlineCount / TOTAL_SEATS) * 100);

  return (
    <div className="space-y-4">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#D7F83C] ring-2 ring-[#17181A]" />
            <h1 className="text-xl font-semibold tracking-tight text-[#14150F]">Lab Control Console</h1>
          </div>
          <p className="text-xs text-[#6E7066] mt-0.5">
            41 consoles monitored · {onlineCount} online · {seatedCount} seated · Realtime LiveKit &amp; socket control
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/sessions"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#17181A] px-4 py-2 text-xs font-semibold text-[#F5F5F0] transition hover:bg-black"
          >
            <span>Session builder</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Row 1: HeroCard (Profile / Status) + DarkStatCard (Spotlight Metric) */}
      <div className="grid grid-cols-12 gap-4">
        {/* Profile / Status Hero Card (§5.1) */}
        <div className="col-span-12 xl:col-span-7">
          <HeroCard
            teacherName={user?.fullName ?? 'Instructor'}
            teacherRole={user?.role === 'ADMIN' ? 'Lab administrator' : 'Class instructor'}
            title={currentClass?.title ?? 'Digital Language Lab'}
            metadata={
              currentClass && currentClass.state === 'ACTIVE'
                ? `Active class code: ${currentClass.code} · ${currentClass.memberCount} student${currentClass.memberCount === 1 ? '' : 's'} enrolled`
                : 'No active session running · Start class or manage student stations below'
            }
            progressPercent={seatedPercent}
            progressLabel={`${seatedCount} of ${TOTAL_SEATS - 1} seats filled`}
            statusBadge={currentClass?.state === 'ACTIVE' ? 'Live session' : 'Standby'}
            actionLabel={currentClass?.state === 'ACTIVE' ? 'End class' : 'Start class'}
            isActionActive={currentClass?.state === 'ACTIVE'}
            actionDisabled={classActionBusy}
            onAction={handleToggleClass}
            secondaryControl={
              currentClass && currentClass.state === 'ACTIVE' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#6E7066]">Classroom code:</span>
                  <span className="font-mono text-sm font-bold tracking-wider text-[#14150F]">{currentClass.code}</span>
                  <CopyButton value={currentClass.code} label="class code" />
                </div>
              ) : (
                <input
                  type="text"
                  value={classTitleInput}
                  onChange={(e) => setClassTitleInput(e.target.value)}
                  placeholder="Optional class title…"
                  className="w-full max-w-xs rounded-full border border-[rgba(20,21,15,0.12)] bg-[#E5E8DC]/50 px-3.5 py-1.5 text-xs text-[#14150F] outline-none focus:border-[#17181A]"
                />
              )
            }
          />
        </div>

        {/* Dark Stat Card with Sparkline (§5.4) — Single spotlight card per screen */}
        <div className="col-span-12 xl:col-span-5">
          <DarkStatCard
            label="Lab connectivity & health"
            value={`${onlineCount} / ${TOTAL_SEATS}`}
            delta={`+${onlinePercent}% active`}
            periodLabel="Live status"
            sparklineData={[30, 32, 35, 34, 38, 40, onlineCount]}
          />
        </div>
      </div>

      {/* Row 2: Bento Fast-Scanning Metric Cards */}
      <div className="grid grid-cols-12 gap-4">
        {/* Big-Number Card: Seated Students (§5.5) */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <BigNumberCard
            label="Active students seated"
            value={seatedCount}
            unit="students"
            icon={Users2}
            subtext={`${TOTAL_SEATS - 1 - seatedCount} student consoles available`}
            accentBadge={seatedCount > 0 ? 'In session' : undefined}
          />
        </div>

        {/* Big-Number Card: Online Stations (§5.5) */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <BigNumberCard
            label="Stations online"
            value={onlineCount}
            unit={`/ ${TOTAL_SEATS}`}
            icon={Monitor}
            subtext={`${rows.size - onlineCount} offline or standby`}
          />
        </div>

        {/* Calendar Strip Card (§5.2) */}
        <div className="col-span-12 lg:col-span-4">
          <CalendarStripCard
            title="Weekly timetable"
            subtitle="Today's lab schedule"
            nextSessionText="Next: Unit 4 Pronunciation · 14:00"
          />
        </div>
      </div>

      {/* Row 3: Live Seat Grid & Control Matrix Bento Card (§6) */}
      <BentoCard variant="light" className="p-6">
        {/* Header with Title, Selection Counter & Quick Create Activity Action */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(20,21,15,0.08)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-card-title text-[#14150F]">Station Control Matrix</h2>
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-[#14150F]">
                41 seats
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[#6E7066]">
              1 Teacher console + 40 Student stations · Select stations to trigger actions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <span className="rounded-full bg-[#17181A] px-3 py-1 text-xs font-semibold text-[#F5F5F0]">
                  {selectedIds.length} selected
                </span>
                <button
                  type="button"
                  onClick={handleCreateActivity}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#D7F83C] px-4 py-2 text-xs font-semibold text-[#14150F] transition-all hover:bg-[#c6e433]"
                >
                  <span>Create activity</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="mb-4">
          <Toolbar busy={busy || selectedIds.length === 0} onAction={runAction} target={target} studentTarget={studentTarget} />
        </div>

        {lastAction && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#17181A] px-3.5 py-1.5 text-xs text-[#F5F5F0]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#D7F83C]" />
            <span>{lastAction}</span>
          </div>
        )}

        {/* Legend */}
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[#6E7066]">
          <span className="font-semibold text-[#14150F]">Legend:</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full ring-2 ring-[#17181A] bg-[#17181A]" />
            Teacher seat (T-01)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#6FCF6F]" />
            Ready / Online
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#38bdf8]" />
            Active student
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#C9503F]" />
            Locked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#6E7066]/40" />
            Offline
          </span>
        </div>

        {/* 41 Seat Tiles */}
        <div className="grid grid-cols-7 gap-2.5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-11">
          {Array.from({ length: TOTAL_SEATS }, (_, i) => i + 1).map((seatNo) => {
            const station = bySeat.get(seatNo);
            const isTeacher = seatNo === 1;
            const isSelected = station && selected.has(station.stationId);
            return (
              <button
                key={seatNo}
                type="button"
                onClick={() => toggleSeat(station?.stationId)}
                disabled={!station}
                className={seatClasses(station?.lifecycle, isTeacher, isSelected)}
                title={
                  station
                    ? `${station.hostname} · ${station.appVersion ?? 'unknown'}` +
                      (station.currentUser
                        ? ` · ${station.currentUser.fullName} (${station.currentUser.serviceNumber})`
                        : ' · no student seated') +
                      (isAdmin && station.liveClass ? ` · ${station.liveClass.title} (${station.liveClass.teacherName})` : '')
                    : 'Unclaimed'
                }
              >
                <span className="text-xs font-semibold leading-none">{seatLabel(seatNo)}</span>
                {station?.currentUser && (
                  <span className="mt-1 max-w-full truncate px-1 text-[10px] font-medium leading-tight text-[#14150F]" title={station.currentUser.fullName}>
                    {station.currentUser.fullName.split(' ')[0]}
                  </span>
                )}
                {/* Lock-type badge */}
                {station?.lock && (
                  <span
                    className="absolute left-1.5 top-1.5 text-[9px] leading-none"
                    title={station.lock.screen ? 'Screen locked' : 'Keyboard & mouse locked'}
                  >
                    {station.lock.screen ? '🔒' : '⌨️'}
                  </span>
                )}
                {station?.screenSharing && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#D7F83C] ring-1 ring-[#17181A]" title="Sharing to class" />
                )}
              </button>
            );
          })}

          {/* Unclaimed station tiles */}
          {unclaimedStations.map((station) => {
            const isSelected = selected.has(station.stationId);
            return (
              <button
                key={station.stationId}
                type="button"
                onClick={() => toggleSeat(station.stationId)}
                className={seatClasses(station.lifecycle, false, isSelected)}
                title={`${station.hostname} · ${station.appVersion ?? 'unknown version'} · Unassigned`}
              >
                <span className="max-w-full truncate px-1 text-center text-[9px] font-semibold leading-tight">{station.hostname}</span>
                {station.lock && (
                  <span className="absolute left-1.5 top-1.5 text-[9px] leading-none">
                    {station.lock.screen ? '🔒' : '⌨️'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected Seat Detail Panel */}
        {selectedIds.length === 1 && (
          <SeatDetailPanel
            station={rows.get(selectedIds[0]!)}
            isAdmin={isAdmin}
            onTakeRemoteControl={() => setRemoteControlTarget(selectedIds[0]!)}
            onShareToClass={() => void handleShareToClass(selectedIds[0]!, false)}
            onStopSharing={() => void handleStopSharing(selectedIds[0]!)}
            onReleaseStudent={async () => {
              setLastAction(null);
              try {
                await classroomApi.releaseStudent(selectedIds[0]!);
                setLastAction('Released student from seat');
                await refetch();
              } catch (err) {
                setLastAction(`Release failed: ${err instanceof Error ? err.message : 'unknown error'}`);
              }
            }}
          />
        )}

        {/* Unclaimed Stations Panel (Admin) */}
        {isAdmin && unclaimedStations.length > 0 && (
          <div className="mt-5">
            <UnclaimedStationsPanel
              stations={unclaimedStations}
              freeSeats={freeSeats}
              assigningId={assigningId}
              onAssign={handleAssignSeat}
            />
          </div>
        )}
      </BentoCard>

      {/* Row 4: Broadcast Intercom & Ongoing Activities */}
      <div className="grid grid-cols-12 gap-4">
        {/* Broadcast Panel */}
        <div className="col-span-12 lg:col-span-6">
          <BroadcastPanel isAdmin={isAdmin} classId={currentClass?.id ?? null} />
        </div>

        {/* Ongoing Activities */}
        <div className="col-span-12 lg:col-span-6">
          <BentoCard variant="light" className="p-5">
            <div className="mb-3 flex items-center justify-between border-b border-[rgba(20,21,15,0.08)] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#14150F]">Ongoing activities</h3>
                <p className="text-xs text-[#6E7066]">Active student group sessions</p>
              </div>
              <Link to="/sessions" className="text-xs font-semibold text-[#14150F] hover:underline">
                Manage sessions →
              </Link>
            </div>
            <SessionList onlyActive emptyText="No ongoing activities — select seats above and click Create activity to start one." />
          </BentoCard>
        </div>
      </div>

      {/* Overlays / Modals */}
      {remoteControlTarget && <RemoteControlView stationId={remoteControlTarget} onClose={() => setRemoteControlTarget(null)} />}
      {spotlight && (
        <ScreenSpotlightPanel
          stationId={spotlight.stationId}
          seatNo={rows.get(spotlight.stationId)?.seatNo ?? null}
          room={spotlight.room}
          viewerToken={spotlight.viewerToken}
          mic={spotlight.mic}
          onMicToggle={() => void handleShareToClass(spotlight.stationId, !spotlight.mic)}
          onStop={() => void handleStopSharing(spotlight.stationId)}
        />
      )}
    </div>
  );
}

function Toolbar({
  busy,
  onAction,
  target,
  studentTarget,
  children,
}: {
  busy: boolean;
  onAction: (label: string, action: () => Promise<unknown>, successMessage?: string) => Promise<void>;
  target: { kind: 'stations'; stationIds: string[] };
  studentTarget: { kind: 'stations'; stationIds: string[] };
  children?: ReactNode;
}) {
  const btn =
    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 border border-[rgba(20,21,15,0.08)]';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#17181A] text-[#F5F5F0] hover:bg-black border-transparent`}
        onClick={() =>
          onAction('Lock', () => controlApi.lock(target, { mode: 'soft', screen: true, input: true, message: 'Screen locked by instructor' }))
        }
      >
        <Lock className="h-3 w-3" />
        <span>Lock screen</span>
      </button>

      <button
        type="button"
        disabled={busy || studentTarget.stationIds.length === 0}
        className={`${btn} bg-[#E5E8DC] text-[#14150F] hover:bg-[#d8dbce]`}
        title="Blocks physical keyboard and mouse only — screen stays visible."
        onClick={() =>
          onAction(
            'Lock Keyboard & Mouse',
            () => controlApi.lock(studentTarget, { mode: 'soft', screen: false, input: true, message: 'Keyboard and mouse locked by instructor' }),
          )
        }
      >
        <Keyboard className="h-3 w-3" />
        <span>Lock kbd &amp; mouse</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#6FCF6F] text-[#14150F] hover:bg-[#5fbe5f] border-transparent`}
        title="Releases any active lock on selected stations."
        onClick={() => onAction('Unlock', () => controlApi.unlock(target))}
      >
        <Unlock className="h-3 w-3" />
        <span>Unlock</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#14150F] hover:bg-white`}
        onClick={() => {
          const text = window.prompt('Message to send to selected consoles:');
          if (text) return onAction('Message', () => controlApi.message(target, text));
        }}
      >
        <MessageSquare className="h-3 w-3" />
        <span>Send message</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#14150F] hover:bg-white`}
        onClick={() => onAction('Wake', () => controlApi.wake(target))}
      >
        <Zap className="h-3 w-3" />
        <span>Wake (WoL)</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#14150F] hover:bg-white`}
        onClick={() => onAction('Restart', () => controlApi.restart(target))}
      >
        <RotateCcw className="h-3 w-3" />
        <span>Restart</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#C9503F] hover:bg-[#C9503F]/10`}
        onClick={() => {
          if (window.confirm(`Shut down ${target.stationIds.length} station(s)?`)) {
            return onAction('Shutdown', () => controlApi.shutdown(target));
          }
        }}
      >
        <Power className="h-3 w-3" />
        <span>Shutdown</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#6E7066] hover:bg-black/5`}
        onClick={() => {
          const count = target.stationIds.length;
          if (
            window.confirm(
              `Windows-lock ${count} station(s)? Only student's Windows password releases it.`,
            )
          ) {
            return onAction('Windows Lock', () => controlApi.lock(target, { mode: 'windows', screen: true, input: true, message: 'Screen locked by instructor' }));
          }
        }}
      >
        <ShieldAlert className="h-3 w-3" />
        <span>Windows lock</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#6E7066] hover:bg-black/5`}
        onClick={() => onAction('Disable', () => controlApi.disable(target))}
      >
        <span>Disable</span>
      </button>

      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-[#F4F4EF] text-[#6E7066] hover:bg-black/5`}
        onClick={() => onAction('Enable', () => controlApi.enable(target))}
      >
        <span>Enable</span>
      </button>

      {children}
    </div>
  );
}

function SeatDetailPanel({
  station,
  isAdmin,
  onTakeRemoteControl,
  onShareToClass,
  onStopSharing,
  onReleaseStudent,
}: {
  station: StationStatusRow | undefined;
  isAdmin: boolean;
  onTakeRemoteControl: () => void;
  onShareToClass: () => void;
  onStopSharing: () => void;
  onReleaseStudent: () => Promise<void>;
}) {
  const [releasing, setReleasing] = useState(false);
  if (!station) return null;

  const canTakeControl = station.lifecycle !== 'OFFLINE' && station.lifecycle !== 'UNCLAIMED';
  const canShareScreen = canTakeControl && !!station.currentUser;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(20,21,15,0.08)] bg-[#E5E8DC]/50 p-4 text-xs text-[#14150F]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold text-sm text-[#14150F]">Seat {seatLabel(station.seatNo)}</span>
        <span className="rounded-full bg-black/5 px-2.5 py-0.5 font-mono text-[11px] text-[#6E7066]">{station.hostname}</span>
        {station.currentUser ? (
          <>
            <span className="text-[#14150F]">
              Student: <span className="font-semibold">{station.currentUser.fullName}</span> ({station.currentUser.serviceNumber})
            </span>
            {isAdmin && station.liveClass && (
              <span className="text-[#6E7066]">
                Class: {station.liveClass.title}
              </span>
            )}
            <button
              type="button"
              disabled={releasing}
              onClick={async () => {
                setReleasing(true);
                try {
                  await onReleaseStudent();
                } finally {
                  setReleasing(false);
                }
              }}
              className="rounded-full bg-black/10 px-3 py-1 font-semibold text-[#14150F] transition hover:bg-black/15 disabled:opacity-40"
            >
              {releasing ? 'Releasing…' : 'Release student'}
            </button>
          </>
        ) : (
          <span className="text-[#6E7066]">No student seated currently</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {station.screenSharing ? (
          <button
            type="button"
            onClick={onStopSharing}
            className="rounded-full bg-[#C9503F] px-3.5 py-1.5 font-semibold text-white transition hover:opacity-90"
          >
            Stop sharing
          </button>
        ) : (
          <button
            type="button"
            disabled={!canShareScreen}
            onClick={onShareToClass}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#17181A] px-3.5 py-1.5 font-semibold text-[#F5F5F0] transition hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Tv className="h-3 w-3" />
            <span>Share screen to class</span>
          </button>
        )}
        <button
          type="button"
          disabled={!canTakeControl}
          onClick={onTakeRemoteControl}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#D7F83C] px-3.5 py-1.5 font-semibold text-[#14150F] transition hover:bg-[#c6e433] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>Take remote control</span>
        </button>
      </div>
    </div>
  );
}

function UnclaimedStationsPanel({
  stations,
  freeSeats,
  assigningId,
  onAssign,
}: {
  stations: StationStatusRow[];
  freeSeats: number[];
  assigningId: string | null;
  onAssign: (stationId: string, seatNo: number) => Promise<void>;
}) {
  if (stations.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[rgba(20,21,15,0.08)] bg-[#E5E8DC]/40 p-4">
      <h3 className="text-xs font-semibold text-[#14150F]">
        {stations.length} station{stations.length === 1 ? '' : 's'} waiting for seat assignment
      </h3>
      <p className="mt-0.5 text-xs text-[#6E7066]">
        Connected and registered, but not yet numbered — assign a seat below to map into the grid.
      </p>
      <ul className="mt-3 space-y-2">
        {stations.map((station) => (
          <UnclaimedStationRow
            key={station.stationId}
            station={station}
            freeSeats={freeSeats}
            busy={assigningId === station.stationId}
            onAssign={onAssign}
          />
        ))}
      </ul>
    </div>
  );
}

function UnclaimedStationRow({
  station,
  freeSeats,
  busy,
  onAssign,
}: {
  station: StationStatusRow;
  freeSeats: number[];
  busy: boolean;
  onAssign: (stationId: string, seatNo: number) => Promise<void>;
}) {
  const [seatNo, setSeatNo] = useState<number | undefined>(freeSeats[0]);

  useEffect(() => {
    if (seatNo === undefined || !freeSeats.includes(seatNo)) setSeatNo(freeSeats[0]);
  }, [freeSeats]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F4F4EF] p-2.5 text-xs text-[#14150F] border border-[rgba(20,21,15,0.08)]">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{station.hostname}</span>
        <span className="text-[#6E7066]">{station.appVersion ?? 'unknown version'}</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={seatNo ?? ''}
          onChange={(e) => setSeatNo(Number(e.target.value))}
          disabled={busy || freeSeats.length === 0}
          className="rounded-full border border-[rgba(20,21,15,0.12)] bg-white px-3 py-1 text-xs text-[#14150F] outline-none"
        >
          {freeSeats.map((n) => (
            <option key={n} value={n}>
              Seat {seatLabel(n)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || seatNo === undefined}
          onClick={() => seatNo !== undefined && void onAssign(station.stationId, seatNo)}
          className="rounded-full bg-[#17181A] px-3.5 py-1 text-xs font-semibold text-[#F5F5F0] transition hover:bg-black disabled:opacity-40"
        >
          {busy ? 'Assigning…' : 'Assign'}
        </button>
      </div>
    </li>
  );
}

function seatClasses(lifecycle: StationStatusRow['lifecycle'] | undefined, isTeacher: boolean, isSelected?: boolean): string {
  const base =
    'relative flex flex-col aspect-square items-center justify-center rounded-2xl border text-[#14150F] transition-all cursor-pointer disabled:cursor-not-allowed select-none p-1';

  if (!lifecycle || lifecycle === 'UNCLAIMED') {
    return `${base} border-dashed border-black/20 bg-transparent text-[#6E7066]`;
  }

  const colors: Record<StationStatusRow['lifecycle'], string> = {
    UNCLAIMED: 'border-dashed border-black/20 bg-transparent text-[#6E7066]',
    OFFLINE: 'border-[rgba(20,21,15,0.08)] bg-[#E5E8DC]/40 text-[#6E7066]/60',
    READY: 'border-[rgba(20,21,15,0.12)] bg-[#F4F4EF] hover:bg-white text-[#14150F]',
    ACTIVE: 'border-[#6FCF6F] bg-[#6FCF6F]/15 text-[#14150F] font-semibold',
    JOINING: 'border-[#E0B84A] bg-[#E0B84A]/15 text-[#14150F]',
    LOCKED: 'border-[#C9503F] bg-[#C9503F]/15 text-[#C9503F] font-semibold',
    ERROR: 'border-[#C9503F] bg-[#C9503F]/25 text-[#C9503F]',
  };

  const ring = isSelected ? 'ring-2 ring-[#D7F83C] bg-[#17181A] text-[#F5F5F0] ring-offset-2 ring-offset-[#F4F4EF]' : '';
  const teacherRing = isTeacher ? 'ring-2 ring-[#17181A] ring-offset-2 ring-offset-[#F4F4EF] font-bold' : '';

  return `${base} ${colors[lifecycle]} ${ring || teacherRing}`;
}
