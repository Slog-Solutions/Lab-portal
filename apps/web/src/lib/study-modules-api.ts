import { apiFetch } from './api-client';

export interface StudyModule {
  id: string;
  title: string;
  createdAt: string;
  exercises: Array<{ id: string; title: string; type: string }>;
}

export const studyModulesApi = {
  list: () => apiFetch<StudyModule[]>('/study-modules'),
  create: (dto: { title: string; exerciseIds: string[] }) =>
    apiFetch<StudyModule>('/study-modules', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, patch: { title?: string; exerciseIds?: string[] }) =>
    apiFetch<StudyModule>(`/study-modules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/study-modules/${id}`, { method: 'DELETE' }),
};
