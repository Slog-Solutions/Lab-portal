import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { StationStatusRow } from '@lab/shared';
import { apiFetch } from '../../lib/api-client';
import { getControlSocket } from '../../lib/socket-client';
import { queryKeys } from '../../lib/query-keys';

export const TOTAL_SEATS = 41; // Annexure-I: 1 teacher + 40 student stations
export const STUDENT_SEATS = TOTAL_SEATS - 1;

export type OccupancySample = {
  x: number; // epoch ms
  online: number;
  seated: number;
};

const SAMPLE_EVERY_MS = 30_000;
const MAX_SAMPLES = 120; // one hour at 30s
const HISTORY_KEY = 'lab.occupancy.history';

function loadHistory(): OccupancySample[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as OccupancySample[]) : [];
    const cutoff = Date.now() - MAX_SAMPLES * SAMPLE_EVERY_MS;
    return Array.isArray(parsed) ? parsed.filter((s) => s.x >= cutoff) : [];
  } catch {
    return [];
  }
}

/**
 * Rolling occupancy history for the overview's line chart. There is no
 * server-side time series for station presence, so this is sampled in the
 * browser from the live feed while Lab control / Class control is open, and
 * kept in sessionStorage so a reload or a hop between the two pages doesn't
 * wipe it. The chart labels it as exactly that.
 */
const useOccupancyHistory = create<{ samples: OccupancySample[]; push: (s: OccupancySample) => void }>((set) => ({
  samples: loadHistory(),
  push: (sample) =>
    set((state) => {
      const last = state.samples[state.samples.length - 1];
      // Collapse samples that land within half an interval of the last one
      // (e.g. both pages mounting), keeping the newest reading.
      const base = last && sample.x - last.x < SAMPLE_EVERY_MS / 2 ? state.samples.slice(0, -1) : state.samples;
      const samples = [...base, sample].slice(-MAX_SAMPLES);
      try {
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(samples));
      } catch {
        // Storage unavailable — history just won't survive a reload.
      }
      return { samples };
    }),
}));

/**
 * The live station board: the REST snapshot (refetched every 10s) with the
 * control socket's full/delta pushes layered on top. Shared by Lab control
 * and Class control so both read the same state the same way.
 */
export function useLabStatus() {
  const { data: initial, refetch } = useQuery({
    queryKey: queryKeys.stationsStatusBoard,
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: 10_000,
  });
  const [rows, setRows] = useState<Map<string, StationStatusRow>>(new Map());

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

  const derived = useMemo(() => {
    const stations = Array.from(rows.values());
    const bySeat = new Map(stations.map((r) => [r.seatNo, r]));
    const unclaimed = stations.filter((r) => r.seatNo === null);
    const takenSeats = new Set(stations.map((r) => r.seatNo).filter((n): n is number => n !== null));
    return {
      stations,
      bySeat,
      unclaimed,
      freeSeats: Array.from({ length: TOTAL_SEATS }, (_, i) => i + 1).filter((n) => !takenSeats.has(n)),
      onlineCount: stations.filter((r) => r.lifecycle !== 'OFFLINE').length,
      seatedCount: stations.filter((r) => r.currentUser).length,
      lockedCount: stations.filter((r) => r.lock || r.lifecycle === 'LOCKED').length,
      screenLockedCount: stations.filter((r) => r.lock?.screen).length,
      sharingCount: stations.filter((r) => r.screenSharing).length,
      errorCount: stations.filter((r) => r.lifecycle === 'ERROR').length,
    };
  }, [rows]);

  // Sample occupancy once data has arrived, then every 30s.
  const push = useOccupancyHistory((s) => s.push);
  const history = useOccupancyHistory((s) => s.samples);
  const hasData = rows.size > 0;
  const { onlineCount, seatedCount } = derived;
  useEffect(() => {
    if (!hasData) return;
    const sample = () => push({ x: Date.now(), online: onlineCount, seated: seatedCount });
    sample();
    const id = window.setInterval(sample, SAMPLE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [hasData, onlineCount, seatedCount, push]);

  return { rows, refetch, history, ...derived };
}
