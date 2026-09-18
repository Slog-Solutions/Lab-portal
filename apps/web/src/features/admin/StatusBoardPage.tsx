import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

const TOTAL_SEATS = 41; // Annexure-I: 1 teacher + 40 student stations

/**
 * The teacher/admin control console (Annexure-I Ser 1 "classroom
 * management and control features"). Live seat grid (design doc §4.4
 * "lab status board") plus a selection + action toolbar wired directly
 * to /api/control/* — this is the page that turns the backend built in
 * this session into something a teacher can actually operate.
 */
export function StatusBoardPage() {
  const user = useAuthStore((s) => s.user);
  const { data: initial, refetch } = useQuery({
    queryKey: ['stations', 'status-board'],
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000, // belt-and-suspenders alongside the socket delta stream
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

  // Every station registers UNCLAIMED (seatNo: null) on first contact — by
  // design (stations.controller.ts: "gains no capability until an admin
  // assigns it a seat") — so it's already connected and present in `rows`
  // but stays invisible in the seat grid below until claimed here. Without
  // this panel there was no way, anywhere in this app, to ever assign one.
  const unclaimedStations = Array.from(rows.values()).filter((r) => r.seatNo === null);
  const takenSeats = new Set(Array.from(rows.values(), (r) => r.seatNo).filter((n): n is number => n !== null));
  const freeSeats = Array.from({ length: TOTAL_SEATS }, (_, i) => i + 1).filter((n) => !takenSeats.has(n));

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const target = { kind: 'stations' as const, stationIds: selectedIds };

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

  function toggleSeat(stationId: string | undefined): void {
    if (!stationId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
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

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-50">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">Lab Control Console</h1>
          <p className="text-sm text-slate-400">
            {viewerIsTeacher
              ? `${seatedCount} student${seatedCount === 1 ? '' : 's'} in your class · signed in as ${user?.fullName} · ${selectedIds.length} selected`
              : `${onlineCount} / ${TOTAL_SEATS} seats online · ${seatedCount} / ${TOTAL_SEATS - 1} students seated · signed in as ${user?.fullName} (${user?.role}) · ${selectedIds.length} selected`}
          </p>
        </div>
        <Link to="/sessions" className="text-sm text-sky-400 hover:underline">
          Session Builder →
        </Link>
      </header>

      {isAdmin && (
        <UnclaimedStationsPanel
          stations={unclaimedStations}
          freeSeats={freeSeats}
          assigningId={assigningId}
          onAssign={handleAssignSeat}
        />
      )}

      <ClassroomPanel
        currentClass={currentClass}
        visible={viewerIsTeacher || !!currentClass}
        onChanged={async () => {
          await refetchClass();
          await refetch();
        }}
      />

      <BroadcastPanel />
      <Toolbar busy={busy || selectedIds.length === 0} onAction={runAction} target={target} />
      {lastAction && <p className="mb-4 text-sm text-sky-400">{lastAction}</p>}

      <div className="grid grid-cols-7 gap-3 sm:grid-cols-8 md:grid-cols-10">
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
                    (station.currentUser ? ` · ${station.currentUser.fullName} (${station.currentUser.serviceNumber})` : ' · no student seated') +
                    (isAdmin && station.liveClass ? ` · ${station.liveClass.title} (${station.liveClass.teacherName})` : '')
                  : 'Unclaimed'
              }
            >
              <span className="text-xs font-medium">{seatLabel(seatNo)}</span>
              {station?.currentUser && (
                <span className="mt-0.5 max-w-full truncate text-[9px] leading-none text-slate-300/80">
                  {station.currentUser.serviceNumber.replace('STU-', '')}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedIds.length === 1 && (
        <SeatDetailPanel
          station={rows.get(selectedIds[0]!)}
          isAdmin={isAdmin}
          onTakeRemoteControl={() => setRemoteControlTarget(selectedIds[0]!)}
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
      {remoteControlTarget && <RemoteControlView stationId={remoteControlTarget} onClose={() => setRemoteControlTarget(null)} />}
    </div>
  );
}

/** Shown for whichever single seat is selected in the grid — the "manage
 * who's sitting here" surface the seat tiles themselves are too small for.
 * Release is available regardless of role (see classroom.controller.ts's
 * release-student route: ADMIN or TEACHER — scoped to a TEACHER's own
 * class), matching every other day-to-day control action on this page. */
function SeatDetailPanel({
  station,
  isAdmin,
  onTakeRemoteControl,
  onReleaseStudent,
}: {
  station: StationStatusRow | undefined;
  isAdmin: boolean;
  onTakeRemoteControl: () => void;
  onReleaseStudent: () => Promise<void>;
}) {
  const [releasing, setReleasing] = useState(false);
  if (!station) return null;

  // A seat that isn't online can't answer a remote-control start — the
  // request would 503 (LiveKit room created, but nothing ever publishes
  // into it) or worse, silently no-op (ControlGateway emits into an
  // empty Socket.IO room). Surface that up front instead of letting the
  // teacher click into a black screen with no explanation.
  const canTakeControl = station.lifecycle !== 'OFFLINE' && station.lifecycle !== 'UNCLAIMED';

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
      <span className="font-medium text-slate-200">Seat {seatLabel(station.seatNo)}</span>
      <span className="text-slate-400">{station.hostname}</span>
      {station.currentUser ? (
        <>
          <span className="text-slate-300">
            Seated: <span className="font-medium">{station.currentUser.fullName}</span> ({station.currentUser.serviceNumber})
          </span>
          {isAdmin && station.liveClass && (
            <span className="text-slate-400">
              Class: {station.liveClass.title} ({station.liveClass.teacherName})
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
            className="rounded-md bg-slate-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {releasing ? 'Releasing…' : 'Release student'}
          </button>
        </>
      ) : (
        <span className="text-slate-500">No student seated — student self-claims from the console</span>
      )}
      <button
        type="button"
        disabled={!canTakeControl}
        onClick={onTakeRemoteControl}
        title={canTakeControl ? undefined : 'Station is offline — remote control needs the seat to be connected'}
        className="ml-auto rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Take Remote Control
      </button>
    </div>
  );
}

function Toolbar({
  busy,
  onAction,
  target,
}: {
  busy: boolean;
  onAction: (label: string, action: () => Promise<unknown>, successMessage?: string) => Promise<void>;
  target: { kind: 'stations'; stationIds: string[] };
}) {
  const btn = 'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <button
        disabled={busy}
        className={`${btn} bg-red-700 text-white hover:bg-red-600`}
        onClick={() => onAction('Lock', () => controlApi.lock(target, { screen: true, input: true, message: 'Screen locked by instructor' }))}
      >
        Lock Screen
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600`}
        onClick={() =>
          onAction('Unlock', () => controlApi.unlock(target), 'Lock released — students sign in with their Windows password')
        }
      >
        Unlock
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-sky-700 text-white hover:bg-sky-600`}
        onClick={() => {
          const text = window.prompt('Message to send:');
          if (text) return onAction('Message', () => controlApi.message(target, text));
        }}
      >
        Send Message
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-amber-700 text-white hover:bg-amber-600`}
        onClick={() => onAction('Wake', () => controlApi.wake(target))}
      >
        Wake (WoL)
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-slate-700 text-white hover:bg-slate-600`}
        onClick={() => onAction('Restart', () => controlApi.restart(target))}
      >
        Restart
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-red-900 text-white hover:bg-red-800`}
        onClick={() => {
          if (window.confirm(`Shut down ${target.stationIds.length} station(s)?`)) {
            return onAction('Shutdown', () => controlApi.shutdown(target));
          }
        }}
      >
        Shutdown
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}
        onClick={() => onAction('Disable', () => controlApi.disable(target))}
      >
        Disable Station
      </button>
      <button
        disabled={busy}
        className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}
        onClick={() => onAction('Enable', () => controlApi.enable(target))}
      >
        Enable Station
      </button>
    </div>
  );
}

/**
 * Manual override, admin-only (a TEACHER never receives an unseated row
 * at all — the server's /control/status-board filters a TEACHER's view
 * to their own class, and a station only ever gets a seat number/class
 * together, at a real classroom sign-in — see StationsService.claim).
 * PCs get numbered automatically at first sign-in now; this panel exists
 * for the rare case an admin needs to pre-assign a seat by hand.
 */
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
    <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/30 p-4">
      <h2 className="mb-1 text-sm font-semibold text-amber-200">
        {stations.length} station{stations.length === 1 ? '' : 's'} waiting for a seat
      </h2>
      <p className="mb-3 text-xs text-amber-200/70">
        Connected and registered, but not yet assigned a seat number — invisible on the grid below until claimed.
      </p>
      <ul className="space-y-2">
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

  // Keep the selection valid if another admin claims seats concurrently
  // (or this row's own pick just got taken) and freeSeats shrinks under us.
  useEffect(() => {
    if (seatNo === undefined || !freeSeats.includes(seatNo)) setSeatNo(freeSeats[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeSeats]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-900/60 px-3 py-2 text-sm">
      <span className="text-slate-200">
        {station.currentUser ? (
          <>
            {station.currentUser.fullName}
            <span className="ml-2 text-xs text-slate-500">({station.currentUser.serviceNumber})</span>
            <span className="ml-2 text-xs text-slate-600">{station.hostname}</span>
          </>
        ) : (
          <>
            {station.hostname}
            <span className="ml-2 text-xs text-slate-500">no student signed in yet</span>
          </>
        )}
        <span className="ml-2 text-xs text-slate-500">{station.appVersion ?? 'unknown version'}</span>
      </span>
      <span className="flex items-center gap-2">
        <select
          value={seatNo ?? ''}
          onChange={(e) => setSeatNo(Number(e.target.value))}
          disabled={busy || freeSeats.length === 0}
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
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
          className="rounded-md bg-sky-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Assigning…' : 'Assign'}
        </button>
      </span>
    </li>
  );
}

/**
 * Teacher/admin classroom lifecycle (design decision: "at the start of
 * class the teacher creates a classroom code"). Shown for any TEACHER
 * (who always needs one to control anything) or for an ADMIN who has
 * started a class themselves — an ADMIN who hasn't never needs this,
 * since they already see and control every PC without one.
 */
function ClassroomPanel({
  currentClass,
  visible,
  onChanged,
}: {
  currentClass: ClassView | null | undefined;
  visible: boolean;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await classroomApi.start(title.trim() || undefined);
      setTitle('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start class');
    } finally {
      setBusy(false);
    }
  }

  async function end(): Promise<void> {
    if (!currentClass) return;
    const count = currentClass.memberCount;
    if (!window.confirm(`This signs out all ${count} student${count === 1 ? '' : 's'}. End class?`)) return;
    setBusy(true);
    setError(null);
    try {
      await classroomApi.end(currentClass.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end class');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
      {currentClass && currentClass.state === 'ACTIVE' ? (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-slate-500">Classroom code</p>
            <p className="text-2xl font-bold tracking-widest text-sky-400">{currentClass.code}</p>
          </div>
          <p className="text-sm text-slate-400">
            {currentClass.memberCount} student{currentClass.memberCount === 1 ? '' : 's'} joined
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void end()}
            className="ml-auto rounded-md bg-red-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Ending…' : 'End class'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Class title (optional)"
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Start class'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function seatClasses(lifecycle: StationStatusRow['lifecycle'] | undefined, isTeacher: boolean, isSelected?: boolean): string {
  const base =
    'flex flex-col aspect-square items-center justify-center rounded-md border text-slate-50 transition disabled:cursor-not-allowed';
  if (!lifecycle || lifecycle === 'UNCLAIMED')
    return `${base} border-dashed border-slate-700 bg-slate-900 text-slate-600`;
  const colors: Record<StationStatusRow['lifecycle'], string> = {
    UNCLAIMED: 'border-slate-700 bg-slate-900',
    OFFLINE: 'border-slate-800 bg-slate-900 text-slate-600',
    JOINING: 'border-amber-600 bg-amber-950',
    READY: 'border-emerald-600 bg-emerald-950',
    ACTIVE: 'border-sky-500 bg-sky-950',
    LOCKED: 'border-red-500 bg-red-950',
    ERROR: 'border-red-600 bg-red-900',
  };
  const ring = isSelected ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-yellow-400' : '';
  const teacherRing = isTeacher ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-violet-500' : '';
  return `${base} ${colors[lifecycle]} ${ring || teacherRing}`;
}
