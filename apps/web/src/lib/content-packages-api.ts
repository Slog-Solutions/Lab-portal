import type { MediaAssetScope } from '@lab/shared';
import { apiFetch, apiUpload } from './api-client';

export interface ContentPackage {
  id: string;
  ownerId: string | null;
  builtinKey: string | null;
  publisher: string | null;
  gradeLevel: string | null;
  cefrLevel: string | null;
  description: string | null;
  scope: MediaAssetScope;
  title: string;
  format: string;
  entryPoint: string;
  sizeBytes: number;
  importedAt: string;
}

export const contentPackagesApi = {
  list: () => apiFetch<ContentPackage[]>('/content-packages'),
  get: (id: string) => apiFetch<ContentPackage>(`/content-packages/${id}`),
  import: (
    file: File,
    params: { title: string; format: string; scope: MediaAssetScope; publisher?: string; gradeLevel?: string; cefrLevel?: string; description?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', params.title);
    form.append('format', params.format);
    form.append('scope', params.scope);
    for (const key of ['publisher', 'gradeLevel', 'cefrLevel', 'description'] as const) {
      if (params[key]) form.append(key, params[key]!);
    }
    return apiUpload<ContentPackage>('/content-packages', form);
  },
  remove: (id: string) => apiFetch<{ ok: true }>(`/content-packages/${id}`, { method: 'DELETE' }),
};
