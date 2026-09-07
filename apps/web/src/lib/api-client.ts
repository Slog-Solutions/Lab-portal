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
