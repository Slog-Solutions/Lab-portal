import type { StationStatusRow } from '@lab/shared';

export type Lifecycle = StationStatusRow['lifecycle'];

/**
 * One entry per seat state, shared by the overview donut, the seat grid, its
 * legend and the inspector — so a state is the same colour and word
 * everywhere. `dot` is the Tailwind fill; `color` the same token as a CSS
 * value for SVG.
 */
export const SEAT_STATES: Array<{ key: Lifecycle | 'NONE'; label: string; dot: string; color: string }> = [
  { key: 'ACTIVE', label: 'Active student', dot: 'bg-status-online', color: 'var(--color-status-online)' },
  { key: 'READY', label: 'Ready', dot: 'bg-status-info', color: 'var(--color-status-info)' },
  { key: 'JOINING', label: 'Joining', dot: 'bg-status-pending', color: 'var(--color-status-pending)' },
  { key: 'LOCKED', label: 'Locked', dot: 'bg-brand', color: 'var(--color-brand)' },
  { key: 'ERROR', label: 'Error', dot: 'bg-status-offline', color: 'var(--color-status-offline)' },
  { key: 'OFFLINE', label: 'Offline', dot: 'bg-muted-foreground/40', color: 'color-mix(in srgb, var(--color-muted-foreground) 40%, transparent)' },
  { key: 'NONE', label: 'Not registered', dot: 'bg-muted', color: 'var(--color-muted)' },
];

export function stateOf(lifecycle: Lifecycle | undefined) {
  return SEAT_STATES.find((s) => s.key === lifecycle) ?? SEAT_STATES[SEAT_STATES.length - 1]!;
}

/** Seat counts by state over the whole 41-seat lab (unregistered seats included). */
export function countSeatStates(stations: StationStatusRow[], totalSeats: number) {
  const seated = stations.filter((r) => r.seatNo !== null);
  return SEAT_STATES.map((s) => ({
    ...s,
    count: s.key === 'NONE' ? Math.max(0, totalSeats - seated.length) : seated.filter((r) => r.lifecycle === s.key).length,
  }));
}
