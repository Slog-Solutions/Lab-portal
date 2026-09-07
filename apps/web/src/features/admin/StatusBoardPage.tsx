import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { controlApi } from '../../lib/control-api';
import { getControlSocket } from '../../lib/socket-client';
import { useAuthStore } from '../../stores/auth-store';

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
  const [rows, setRows] = useState<Map<string, StationStatusRow>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

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

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const target = { kind: 'stations' as const, stationIds: selectedIds };

  function toggleSeat(stationId: string | undefined): void {
    if (!stationId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  }

  async function runAction(label: string, action: () => Promise<unknown>): Promise<void> {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setLastAction(null);
    try {
      await action();
      setLastAction(`${label}: ${selectedIds.length} station(s)`);
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
            {onlineCount} / {TOTAL_SEATS} seats online · signed in as {user?.fullName} ({user?.role}) ·{' '}
            {selectedIds.length} selected
          </p>
        </div>
      </header>

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
              title={station ? `${station.hostname} · ${station.appVersion ?? 'unknown'}` : 'Unclaimed'}
            >
              <span className="text-xs font-medium">{isTeacher ? 'T' : seatNo - 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({
  busy,
  onAction,
  target,
}: {
  busy: boolean;
  onAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
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
        onClick={() => onAction('Unlock', () => controlApi.unlock(target))}
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

function seatClasses(lifecycle: StationStatusRow['lifecycle'] | undefined, isTeacher: boolean, isSelected?: boolean): string {
  const base =
    'flex aspect-square items-center justify-center rounded-md border text-slate-50 transition disabled:cursor-not-allowed';
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
