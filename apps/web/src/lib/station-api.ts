import { getRuntimeConfig } from './runtime-config';

/**
 * Fetch wrapper for the STATION's own authenticated calls (attempts,
 * claim/release) — parallel to lib/api-client.ts's apiFetch, but using
 * the station's own token (from station:hello) rather than the human
 * dashboard's auth store. There is no human login on a student seat.
 */
async function stationFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
  const res = await fetch(`${serverUrl}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface StartedAttempt {
  attemptId: string;
  exercise: { id: string; type: string; title: string; config: unknown };
  items?: Array<{ id: string; prompt: string; choices: string[]; mediaAssetId?: string }>;
}

export const stationApi = {
  claim: (token: string | null, serviceNumber: string) =>
    stationFetch<{ ok: true; userId: string; fullName: string }>('/stations/claim', token, {
      method: 'POST',
      body: JSON.stringify({ serviceNumber }),
    }),
  release: (token: string | null) => stationFetch<{ ok: true }>('/stations/release', token, { method: 'POST' }),

  myAssignments: (token: string | null) =>
    stationFetch<
      Array<{
        assignment: { id: string; targetScore: number | null; allocatedHours: number | null; dueAt: string | null };
        exercise: { id: string; title: string; type: string };
        latestAttempt: { id: string; status: string; rawScore: number | null; maxScore: number | null } | null;
      }>
    >('/attempts/assignments/mine', token),

  startAttempt: (token: string | null, body: { exerciseId: string; assignmentId?: string }) =>
    stationFetch<StartedAttempt>('/attempts/start', token, { method: 'POST', body: JSON.stringify(body) }),

  /** Ser 1 self-study library (Phase 4) — station-authenticated, no
   * claimed student or live session required to browse (see
   * study-modules.controller.ts's doc comment); starting an exercise from
   * it still needs a claimed student, same as My Assignments. */
  studyLibrary: (token: string | null) =>
    stationFetch<Array<{ id: string; title: string; exercises: Array<{ id: string; title: string; type: string }> }>>(
      '/study-modules/library',
      token,
    ),

  submitAttempt: (
    token: string | null,
    attemptId: string,
    body: { response: unknown; itemResponses?: Array<{ itemId: string; given: string }> },
  ) => stationFetch(`/attempts/${attemptId}/submit`, token, { method: 'POST', body: JSON.stringify(body) }),
};
