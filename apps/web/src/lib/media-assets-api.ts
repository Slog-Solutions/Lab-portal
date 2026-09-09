import type { MediaAssetScope } from '@lab/shared';
import { apiFetch, apiUpload } from './api-client';

export interface MediaAsset {
  id: string;
  ownerId: string;
  scope: MediaAssetScope;
  kind: string;
  title: string | null;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  durationMs: number | null;
  createdAt: string;
}

export const mediaAssetsApi = {
  list: () => apiFetch<MediaAsset[]>('/media-assets'),
  get: (id: string) => apiFetch<MediaAsset>(`/media-assets/${id}`),
  upload: (file: File, params: { kind: string; title?: string; scope: MediaAssetScope }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', params.kind);
    if (params.title) form.append('title', params.title);
    form.append('scope', params.scope);
    return apiUpload<MediaAsset>('/media-assets', form);
  },
  update: (id: string, patch: { title?: string; scope?: MediaAssetScope }) =>
    apiFetch<MediaAsset>(`/media-assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/media-assets/${id}`, { method: 'DELETE' }),
};
