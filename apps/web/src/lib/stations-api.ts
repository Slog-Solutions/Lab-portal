import type { StationAssignSeatDto } from '@lab/shared';
import { apiFetch } from './api-client';

/** Thin wrappers over /api/stations/* (apps/server StationsController).
 * Deliberately separate from control-api.ts — these hit StationsController,
 * not ControlController, and assign-seat/swap-seats are ADMIN-only (seat
 * mapping is a one-time lab setup step, not a day-to-day teacher action;
 * PCs otherwise get numbered automatically at first classroom sign-in —
 * see StationsService.claim). Releasing a claimed student now lives on
 * classroom-api.ts (POST /classroom/stations/:id/release-student) — that
 * route is class-scoped for a TEACHER, unlike anything here. */
export const stationsApi = {
  assignSeat: (dto: StationAssignSeatDto) => apiFetch('/stations/assign-seat', { method: 'POST', body: JSON.stringify(dto) }),
  swapSeats: (stationIdA: string, stationIdB: string) =>
    apiFetch(`/stations/swap-seats/${stationIdA}/${stationIdB}`, { method: 'POST' }),
  /** Move a station to another seat — swaps when that seat is taken. Served
   * by ControlController, not StationsController, because it also re-tells
   * the affected PCs their new number live (needs ControlGateway). */
  changeSeat: (stationId: string, seatNo: number) =>
    apiFetch<{ ok: true; swappedWithStationId: string | null }>(`/control/stations/${stationId}/seat`, {
      method: 'POST',
      body: JSON.stringify({ seatNo }),
    }),
};
