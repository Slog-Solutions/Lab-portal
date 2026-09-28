import { apiFetch } from './api-client';

export interface ClassView {
  id: string;
  code: string;
  title: string;
  state: 'ACTIVE' | 'ENDED';
  memberCount: number;
  /** Set when this live class was started FROM a My Classes roster
   * ("Start Live Class" on ClassDetailPage) rather than ad hoc from Lab
   * Control — see the server's LiveClass.batchId doc comment. */
  batchId: string | null;
}

/** Thin wrappers over /api/classroom/* (apps/server ClassroomController) —
 * the teacher/admin dashboard-side half of the classroom feature. The
 * student-seat half (sign-in/sign-out) goes through lib/station-api.ts's
 * stationApi.claim/release instead, since it's authenticated with the
 * station's own token, not a dashboard JWT. */
export const classroomApi = {
  current: () => apiFetch<ClassView | null>('/classroom/current'),
  /** `batchId` scopes it to a My Classes roster: every enrolled student
   * already signed in joins immediately, and anyone who signs in later
   * (while it stays ACTIVE) auto-joins too — no code needed for that class. */
  start: (params: { title?: string; batchId?: string } = {}) =>
    apiFetch<ClassView>('/classroom/start', { method: 'POST', body: JSON.stringify(params) }),
  end: (id: string) => apiFetch<ClassView>(`/classroom/${id}/end`, { method: 'POST' }),
  /** ADMIN or TEACHER (own class only) — frees a seat's claimed student
   * without touching that PC. */
  releaseStudent: (stationId: string) => apiFetch<{ ok: true }>(`/classroom/stations/${stationId}/release-student`, { method: 'POST' }),
};
