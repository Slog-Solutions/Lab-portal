import type { StationAssignSeatDto } from '@lab/shared';
import { apiFetch } from './api-client';

/** Thin wrappers over /api/stations/* (apps/server StationsController).
 * Deliberately separate from control-api.ts — these hit StationsController,
 * not ControlController, and assign-seat/swap-seats are ADMIN-only (seat
 * mapping is a one-time lab setup step, not a day-to-day teacher action). */
export const stationsApi = {
  assignSeat: (dto: StationAssignSeatDto) => apiFetch('/stations/assign-seat', { method: 'POST', body: JSON.stringify(dto) }),
  swapSeats: (stationIdA: string, stationIdB: string) =>
    apiFetch(`/stations/swap-seats/${stationIdA}/${stationIdB}`, { method: 'POST' }),
  /** ADMIN or TEACHER — frees a seat's claimed student without touching that PC. */
  releaseStudent: (stationId: string) => apiFetch(`/stations/${stationId}/release-student`, { method: 'POST' }),
};
