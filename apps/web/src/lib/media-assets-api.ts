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
  /** Shown in students' Study Material (never true for a PRIVATE file). */
  studentVisible: boolean;
  /** Classes (Batch ids) it is aimed at while studentVisible; empty = all students. */
  sharedBatchIds: string[];
  /** Study Library folder it is filed in; null = unfiled. */
  folderId: string | null;
  createdAt: string;
}

/** A Study Library folder for one kind of content (teacher-side organisation only). */
export interface MediaFolder {
  id: string;
  name: string;
  kind: string;
  ownerId: string;
  createdAt: string;
}

export const mediaAssetsApi = {
  list: () => apiFetch<MediaAsset[]>('/media-assets'),
  get: (id: string) => apiFetch<MediaAsset>(`/media-assets/${id}`),
  upload: (file: File, params: { kind: string; title?: string; scope: MediaAssetScope; studentVisible?: boolean; sharedBatchIds?: string[]; folderId?: string }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', params.kind);
    if (params.title) form.append('title', params.title);
    form.append('scope', params.scope);
    if (params.studentVisible !== undefined) form.append('studentVisible', String(params.studentVisible));
    // A multipart field can't carry a list, so the ids travel comma-separated.
    if (params.sharedBatchIds?.length) form.append('sharedBatchIds', params.sharedBatchIds.join(','));
    if (params.folderId) form.append('folderId', params.folderId);
    return apiUpload<MediaAsset>('/media-assets', form);
  },
  update: (id: string, patch: { title?: string; scope?: MediaAssetScope; studentVisible?: boolean; sharedBatchIds?: string[]; folderId?: string | null }) =>
    apiFetch<MediaAsset>(`/media-assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/media-assets/${id}`, { method: 'DELETE' }),
  listFolders: () => apiFetch<MediaFolder[]>('/media-assets/folders'),
  createFolder: (body: { name: string; kind: string }) =>
    apiFetch<MediaFolder>('/media-assets/folders', { method: 'POST', body: JSON.stringify(body) }),
  removeFolder: (id: string) => apiFetch<{ ok: true }>(`/media-assets/folders/${id}`, { method: 'DELETE' }),
};
