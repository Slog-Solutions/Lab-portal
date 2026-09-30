import type {
  CourseActivityView,
  CourseCatalogView,
  CourseProgressView,
  CourseResultView,
  StartedCourseActivity,
  SubmitCourseActivityDto,
} from '@lab/shared';
import { apiFetch } from './api-client';
import { stationApi } from './station-api';
import { getRuntimeConfig } from './runtime-config';
import { ApiError } from './api-client';

/** Seat-side calls for the built-in English Course (Ser 10), made with the
 * station token like every other seat call (see station-api.ts). */
async function seatFetch<T>(token: string | null, path: string, init?: RequestInit): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
  const res = await fetch(`${serverUrl}/api/english-course${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText, typeof body.code === 'string' ? body.code : undefined, body);
  }
  return res.json() as Promise<T>;
}

export const englishCourseApi = {
  catalog: (token: string | null) => seatFetch<CourseCatalogView>(token, '/catalog'),
  start: (token: string | null, key: string, assignmentId?: string) =>
    seatFetch<StartedCourseActivity>(token, `/activities/${encodeURIComponent(key)}/start`, {
      method: 'POST',
      body: JSON.stringify(assignmentId ? { assignmentId } : {}),
    }),
  submit: (token: string | null, attemptId: string, dto: SubmitCourseActivityDto) =>
    seatFetch<CourseResultView>(token, `/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify(dto) }),
  result: (token: string | null, attemptId: string) => seatFetch<CourseResultView>(token, `/attempts/${attemptId}/result`),
  progress: (token: string | null) => seatFetch<CourseProgressView>(token, '/progress'),
  /** A recording of the student's own voice, as a playable object URL. */
  recordingUrl: (token: string | null, recordingId: string) => stationApi.fetchBlobUrl(token, `/recordings/${recordingId}/file`),
};

/** Teacher/admin side (dashboard JWT). */
export const englishCourseStaffApi = {
  catalog: () => apiFetch<CourseCatalogView>('/english-course/staff/catalog'),
  preview: (key: string) => apiFetch<CourseActivityView>(`/english-course/staff/activities/${encodeURIComponent(key)}`),
  studentProgress: (studentId: string) =>
    apiFetch<CourseProgressView & { student: { id: string; fullName: string; serviceNumber: string } }>(
      `/english-course/staff/students/${studentId}/progress`,
    ),
  result: (attemptId: string) => apiFetch<CourseResultView>(`/english-course/staff/attempts/${attemptId}/result`),
};
