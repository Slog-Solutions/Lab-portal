import { apiFetch } from './api-client';

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
  mine: () => apiFetch<BatchRow[]>('/batches/mine'),
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
