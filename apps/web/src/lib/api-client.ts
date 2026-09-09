import { getRuntimeConfig } from './runtime-config';
import { useAuthStore } from '../stores/auth-store';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin fetch wrapper: resolves base URL from runtime config, attaches the
 * bearer token, and normalizes error handling. No axios — the surface area
 * here doesn't earn a dependency. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
  const token = useAuthStore.getState().accessToken;

  const res = await fetch(`${serverUrl}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    useAuthStore.getState().clear();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Multipart upload variant — deliberately does NOT set Content-Type
 * (the browser sets the multipart boundary itself); apiFetch's
 * unconditional 'application/json' would otherwise break every upload
 * that goes through it (media assets, content package import). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
  const token = useAuthStore.getState().accessToken;

  const res = await fetch(`${serverUrl}/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (res.status === 401) {
    useAuthStore.getState().clear();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
