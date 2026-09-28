import { apiFetch } from './api-client';

/** An uploaded file attached to a module (a MediaAsset — see study-modules.service.ts). */
export interface StudyMaterial {
  id: string;
  title: string;
  filename: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StudyModule {
  id: string;
  title: string;
  /** The teacher's guidance on how to use this module to prepare. */
  description: string | null;
  createdAt: string;
  exercises: Array<{ id: string; title: string; type: string }>;
  materials: StudyMaterial[];
}

export const studyModulesApi = {
  list: () => apiFetch<StudyModule[]>('/study-modules'),
  create: (dto: { title: string; description?: string; exerciseIds: string[]; materialAssetIds: string[] }) =>
    apiFetch<StudyModule>('/study-modules', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, patch: { title?: string; description?: string; exerciseIds?: string[]; materialAssetIds?: string[] }) =>
    apiFetch<StudyModule>(`/study-modules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/study-modules/${id}`, { method: 'DELETE' }),
};
