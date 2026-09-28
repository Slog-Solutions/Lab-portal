import type { ClassHistoryView, CreateClassroomDto, MyBatchView } from '@lab/shared';
import { apiFetch } from './api-client';
import { getRuntimeConfig } from './runtime-config';
import { useStudentSession } from '../stores/student-session-store';

export interface BatchRow {
  id: string;
  code: string;
  name: string;
  /** ADMIN responses only — absent for TEACHER/STUDENT responses (see
   * BatchesService's ADMIN_BATCH_SELECT vs SAFE_BATCH_SELECT). */
  joinKey?: string;
  joinOpen: boolean;
  createdAt: string;
  updatedAt?: string;
  _count: { enrollments: number; teachers?: number };
}

export interface BatchDetail extends BatchRow {
  teachers: { teacherId: string; assignedAt: string; teacher: { fullName: string; serviceNumber: string } }[];
}

export interface EnrolledStudent {
  userId: string;
  enrolledAt: string;
  source: 'ADMIN' | 'SELF_JOIN';
  user: { serviceNumber: string; fullName: string; active: boolean };
}

export interface MyEnrollment {
  enrolledAt: string;
  source: 'ADMIN' | 'SELF_JOIN';
  batch: BatchRow;
}

export interface CreateBatchInput {
  code: string;
  name: string;
  joinKey: string;
  joinOpen?: boolean;
}

export interface UpdateBatchInput {
  code?: string;
  name?: string;
  joinKey?: string;
  joinOpen?: boolean;
}

export const batchesApi = {
  list: () => apiFetch<BatchRow[]>('/batches'),
  /** The caller's own classes — enrolled (student), taught (teacher) or all
   * (admin). `joinKey` is present only for staff. */
  mine: () => apiFetch<MyBatchView[]>('/batches/mine'),
  /** A student's record of one of their classes: the live activities they
   * took part in, the assignments created from it, and the teacher's own
   * recordings of the whole class broadcast. */
  myActivity: (id: string) => apiFetch<ClassHistoryView>(`/batches/${id}/my-activity`),
  /** A class recording's file, for a student — this is the STUDENT user
   * JWT (useStudentSession, minted at classroom sign-in), not the
   * station token RecordingPlayback uses for per-activity recordings:
   * ClassRecordingsController's student route checks batch enrollment,
   * which only that JWT carries. Caller must revoke the returned URL. */
  fetchClassRecordingBlob: async (recordingId: string): Promise<string> => {
    const { serverUrl } = getRuntimeConfig();
    const token = useStudentSession.getState().token;
    const res = await fetch(`${serverUrl}/api/class-recordings/${recordingId}/student-file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Recording fetch failed (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  /** A teacher creating their own class: code and join key may be omitted and
   * the server generates them. Returns the full row, key included. */
  createClassroom: (dto: Pick<CreateClassroomDto, 'name'> & Partial<Pick<CreateClassroomDto, 'code' | 'joinKey' | 'joinOpen'>>) =>
    apiFetch<BatchRow>('/batches', { method: 'POST', body: JSON.stringify(dto) }),
  /** Rotates the join key; the old one stops working at once. */
  regenerateKey: (id: string) => apiFetch<{ joinKey: string }>(`/batches/${id}/regenerate-key`, { method: 'POST' }),
  get: (id: string) => apiFetch<BatchDetail>(`/batches/${id}`),
  create: (dto: CreateBatchInput) => apiFetch<BatchRow>('/batches', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, patch: UpdateBatchInput) =>
    apiFetch<BatchRow>(`/batches/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/batches/${id}`, { method: 'DELETE' }),
  assignTeachers: (id: string, teacherIds: string[]) =>
    apiFetch<{ ok: true }>(`/batches/${id}/teachers`, { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  unassignTeacher: (id: string, teacherId: string) =>
    apiFetch<{ ok: true }>(`/batches/${id}/teachers/${teacherId}`, { method: 'DELETE' }),
  listStudents: (id: string) => apiFetch<EnrolledStudent[]>(`/batches/${id}/students`),
  enrollStudents: (id: string, studentIds: string[]) =>
    apiFetch<{ ok: true }>(`/batches/${id}/students`, { method: 'POST', body: JSON.stringify({ studentIds }) }),
  unenrollStudent: (id: string, studentId: string) =>
    apiFetch<{ ok: true }>(`/batches/${id}/students/${studentId}`, { method: 'DELETE' }),
  join: (dto: { code: string; joinKey: string }) =>
    apiFetch<{ ok: true; alreadyEnrolled: boolean; batch: { id: string; code: string; name: string } }>('/batches/join', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  myEnrollments: () => apiFetch<MyEnrollment[]>('/batches/my-enrollments'),
};
