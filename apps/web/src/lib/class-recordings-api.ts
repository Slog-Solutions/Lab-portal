import type { ClassRecordingView } from '@lab/shared';
import { apiFetch } from './api-client';
import { getRuntimeConfig } from './runtime-config';
import { useAuthStore } from '../stores/auth-store';

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown by uploadChunk so ClassRecorder can read the server's `nextSeq`
 * off a 409 — apiUpload/ApiError (api-client.ts) drop everything but
 * `message`, which isn't enough to resync a chunked upload. */
export class ChunkUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly nextSeq?: number,
  ) {
    super(message);
  }
}

export const classRecordingsApi = {
  list: () => apiFetch<ClassRecordingView[]>('/class-recordings'),
  remove: (id: string) => apiFetch<{ ok: true }>(`/class-recordings/${id}`, { method: 'DELETE' }),
  start: (withAudio: boolean) => apiFetch<{ id: string }>('/class-recordings', { method: 'POST', body: JSON.stringify({ withAudio }) }),
  finish: (id: string, durationMs: number) =>
    apiFetch<{ status: ClassRecordingView['status'] }>(`/class-recordings/${id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ durationMs }),
    }),

  /** Not apiUpload — that helper forces JSON error parsing down to just a
   * `message`, and ClassRecorder needs the `nextSeq` a 409 carries too. */
  async uploadChunk(id: string, seq: number, blob: Blob): Promise<{ chunkCount: number; duplicate?: true }> {
    const { serverUrl } = getRuntimeConfig();
    const form = new FormData();
    form.append('chunk', blob, `${id}-${seq}.webm`);
    const res = await fetch(`${serverUrl}/api/class-recordings/${id}/chunks?seq=${seq}`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ChunkUploadError(body.message ?? res.statusText, res.status, typeof body.nextSeq === 'number' ? body.nextSeq : undefined);
    }
    return body;
  },

  /** <video src> can't carry an Authorization header — same issue
   * gradebookApi.fetchRecordingBlob solves for station recordings. Caller
   * must revoke the returned URL when done with it. */
  fetchBlobUrl: async (id: string): Promise<string> => {
    const { serverUrl } = getRuntimeConfig();
    const res = await fetch(`${serverUrl}/api/class-recordings/${id}/file`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Recording fetch failed (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};
