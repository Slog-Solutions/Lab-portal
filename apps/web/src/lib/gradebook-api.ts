import { apiFetch } from './api-client';

/** `new URLSearchParams({a: undefined})` stringifies to the literal
 * string "undefined", not an omitted param — confirmed live: the
 * gradebook table came back empty because every filter's `undefined`
 * was being sent (and matched) as the string "undefined". Filtering
 * `undefined` values out here is the fix. */
function toQueryString(filter: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value);
  }
  return params.toString();
}

export interface AttemptRow {
  id: string;
  exerciseId: string;
  studentId: string;
  status: string;
  rawScore: number | null;
  maxScore: number | null;
  startedAt: string;
  submittedAt: string | null;
  exercise: { id: string; title: string; type: string };
  student: { id: string; fullName: string; serviceNumber: string };
  scoreOverride: { id: string; oldScore: number | null; newScore: number; reason: string } | null;
}

export const gradebookApi = {
  createAssignments: (dto: { studentIds: string[]; exerciseIds: string[]; targetScore?: number; allocatedHours?: number; dueAt?: string }) =>
    apiFetch<{ created: number }>('/gradebook/assignments', { method: 'POST', body: JSON.stringify(dto) }),
  listAssignments: (filter: { studentId?: string; exerciseId?: string } = {}) =>
    apiFetch(`/gradebook/assignments?${toQueryString(filter)}`),
  listAttempts: (filter: { studentId?: string; exerciseId?: string; status?: string } = {}) =>
    apiFetch<AttemptRow[]>(`/gradebook/attempts?${toQueryString(filter)}`),
  getAttempt: (id: string) => apiFetch(`/gradebook/attempts/${id}`),
  override: (attemptId: string, newScore: number, reason: string) =>
    apiFetch(`/gradebook/attempts/${attemptId}/override`, {
      method: 'POST',
      body: JSON.stringify({ attemptId, newScore, reason }),
    }),
};
