import { getRuntimeConfig } from './runtime-config';
import { useAuthStore } from '../stores/auth-store';
import { useStudentSession } from '../stores/student-session-store';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable failure code from the response body, when the server
     * sent one (e.g. 'BATCH_JOIN_INVALID') — lets a caller pick its own
     * wording instead of showing the server's prose. */
    public code?: string,
    /** The rest of the response body, when the server put anything extra on
     * it (e.g. TEST_ERROR_CODES.ALREADY_SUBMITTED's `attemptId` — see
     * AttemptsService.startLiveTest) — a caller that needs more than
     * message/code reads it from here rather than every failure mode
     * growing its own ApiError subclass. */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Resolves the bearer token for a human-JWT request. A dashboard login
 * (useAuthStore) wins if both exist; falling back to the student session
 * (useStudentSession — set by POST /classroom/sign-in, see StationsService.claim)
 * is what lets a signed-in student at a seat call JWT-gated routes like
 * GET /batches/my-enrollments with no dashboard login in the picture at
 * all. Returns which store to clear on a 401 so we don't wipe a valid
 * dashboard session just because a student's token expired, or vice versa. */
function resolveToken(): { token: string | null; clearSource: () => void } {
  const authToken = useAuthStore.getState().accessToken;
  if (authToken) return { token: authToken, clearSource: () => useAuthStore.getState().clear() };
  const studentToken = useStudentSession.getState().token;
  if (studentToken) return { token: studentToken, clearSource: () => useStudentSession.getState().clear() };
  return { token: null, clearSource: () => void 0 };
}

/** Thin fetch wrapper: resolves base URL from runtime config, attaches the
 * bearer token, and normalizes error handling. No axios — the surface area
 * here doesn't earn a dependency. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
  const { token, clearSource } = resolveToken();

  const res = await fetch(`${serverUrl}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const code = typeof body.code === 'string' ? body.code : undefined;
    // A 401 that carries a domain `code` (BATCH_JOIN_INVALID, ...) is the
    // server's answer to THIS request — "that class key is wrong" — not proof
    // the session died, so it must not sign the student out. A bare 401 is
    // still an expired/invalid token and clears whichever store supplied it.
    if (res.status === 401 && !code) clearSource();
    throw new ApiError(res.status, body.message ?? res.statusText, code, body);
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
  const { token, clearSource } = resolveToken();

  const res = await fetch(`${serverUrl}/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (res.status === 401) {
    clearSource();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
