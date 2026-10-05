import type { AttemptResultView, DictionaryLookupResult, DictionaryMeta } from '@lab/shared';
import { ApiError } from './api-client';
import { getRuntimeConfig } from './runtime-config';
import type { PronunciationVoice, SpeakResult } from './pronunciation-api';

/**
 * Fetch wrapper for the STATION's own authenticated calls (attempts,
 * claim/release) — parallel to lib/api-client.ts's apiFetch, but using
 * the station's own token (from station:hello) rather than the human
 * dashboard's auth store. There is no human login on a student seat.
 */
async function stationFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const { serverUrl } = getRuntimeConfig();
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
    // ApiError (an Error subclass) rather than a bare Error, so callers can
    // still tell a 429 or a coded failure apart from a plain message —
    // `details` carries the rest of the body (e.g. TEST_ERROR_CODES.ALREADY_SUBMITTED's
    // `attemptId`, see AttemptsService.startLiveTest).
    throw new ApiError(res.status, body.message ?? res.statusText, typeof body.code === 'string' ? body.code : undefined, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface StartedAttemptTiming {
  closesAt: number | null;
  serverNow: number;
  revealMode: 'ON_TIME_EXPIRY' | 'ON_SUBMIT' | 'ON_TEACHER_RELEASE';
  revealDetail: 'SCORE_ONLY' | 'SCORE_AND_FLAGS' | 'FULL_ANSWERS';
  allowReview: boolean;
}

export interface StartedAttempt {
  attemptId: string;
  exercise: { id: string; type: string; title: string; config: unknown; dictionaryEnabled: boolean };
  items?: Array<{ id: string; prompt: string; choices: string[]; mediaAssetId?: string }>;
  /** SPEC-mcq-test-timed-reveal.md — the saved/draft answers for this
   * attempt (itemId -> given), present on resume; empty on a fresh start. */
  answers?: Record<string, string>;
  /** Present only for a VOCABULARY_TEST attempt (null for every other
   * activity type, which has no reveal policy). */
  timing?: StartedAttemptTiming | null;
}

export interface ClaimResponse {
  ok: true;
  userId: string;
  fullName: string;
  serviceNumber: string;
  studentToken: string;
  seatNo: number;
  /** Null when the student signed in without joining a class — see
   * stationApi.joinLiveClass. */
  liveClass: { id: string; title: string; teacherName: string } | null;
}

export const stationApi = {
  /** A real classroom sign-in at this seat (see StationsService.claim's
   * doc comment) — the station's own token authenticates the HTTP caller
   * as a genuine seat; the student's own service number + password prove
   * who they are; systemNumber (the number printed on this PC's screen)
   * becomes its seat number with no admin step. Signing in needs NO class
   * code — a student attaches the seat to a teacher's live class afterwards
   * (joinLiveClass below). On success the server also mints a real STUDENT
   * JWT (studentToken), which callers store in useStudentSession so
   * JWT-gated routes (e.g. batch self-join) work from a seat with no
   * dashboard login involved at all. */
  claim: (token: string | null, serviceNumber: string, password: string, systemNumber: number) =>
    stationFetch<ClaimResponse>('/classroom/sign-in', token, {
      method: 'POST',
      body: JSON.stringify({ serviceNumber, password, systemNumber }),
    }),
  release: (token: string | null) => stationFetch<{ ok: true }>('/classroom/sign-out', token, { method: 'POST' }),

  /** Attaches an already-signed-in seat to the teacher's live class that
   * owns `classCode` (the short code shown on the teacher's dashboard). The
   * server pushes a fresh station snapshot, which is what updates the
   * console header — the response itself needs no local handling. */
  joinLiveClass: (token: string | null, classCode: string) =>
    stationFetch<{ ok: true; liveClass: { id: string; title: string; teacherName: string } }>('/classroom/join', token, {
      method: 'POST',
      body: JSON.stringify({ classCode }),
    }),

  myAssignments: (token: string | null) =>
    stationFetch<
      Array<{
        assignment: { id: string; targetScore: number | null; allocatedHours: number | null; dueAt: string | null };
        exercise: { id: string; title: string; type: string; catalogKey: string | null };
        /** Where the assignment came from — `className` is set only when the
         * assigning teacher teaches exactly one of the student's classes. */
        source: { teacherName: string; className: string | null };
        /** True for a genuinely one-shot test — either a type that always
         * was (writing/reading/listening/pronunciation tests) or a real
         * timed/teacher-released vocabulary test (see resolveTestPolicy). A
         * retryable practice vocabulary test (the ON_SUBMIT legacy default)
         * is false. */
        oneShot: boolean;
        /** True when the latest attempt is SCORED but not yet revealed —
         * `latestAttempt.status` below reads SUBMITTED in that case (masked
         * server-side), not SCORED, so the UI shows "waiting for results"
         * rather than a stale/wrong percentage. */
        resultsPending: boolean;
        latestAttempt: {
          id: string;
          status: string;
          rawScore: number | null;
          maxScore: number | null;
          /** Set once a teacher has scored it (gradebook override) — `reason` is their feedback. */
          scoreOverride?: { newScore: number; reason: string } | null;
        } | null;
      }>
    >('/attempts/assignments/mine', token),

  startAttempt: (token: string | null, body: { exerciseId?: string; assignmentId?: string; activityInstanceId?: string }) =>
    stationFetch<StartedAttempt>('/attempts/start', token, { method: 'POST', body: JSON.stringify(body) }),

  /** §8.1 "Answers buffer locally; a disconnect must not lose them" — this
   * is the save side of that buffer (see features/activities/vocab/use-answer-buffer.ts).
   * Throws ApiError with code TEST_CLOSED/ALREADY_SUBMITTED past the deadline. */
  saveAnswers: (token: string | null, attemptId: string, answers: Array<{ itemId: string; given: string }>) =>
    stationFetch<{ ok: true }>(`/attempts/${attemptId}/answers`, token, { method: 'PUT', body: JSON.stringify({ answers }) }),

  /** GF-4/GF-5 — the student's own result: OPEN while still answering,
   * WAITING before reveal (no score, no hints — see TestResultView), or
   * RELEASED. Safe to poll; also finalizes an individual attempt whose own
   * deadline has quietly passed (the "Offline" acceptance test). */
  attemptResult: (token: string | null, attemptId: string) => stationFetch<AttemptResultView>(`/attempts/${attemptId}/result`, token),

  /** Past attempts of one exercise, newest first — masked the same way
   * assignments/mine is until reveal (see AttemptsService.listForStudent). */
  myAttempts: (token: string | null, exerciseId: string) =>
    stationFetch<
      Array<{ id: string; status: string; rawScore: number | null; maxScore: number | null; startedAt: string; revealAt: string | null }>
    >(`/attempts/mine?exerciseId=${encodeURIComponent(exerciseId)}`, token),

  /** Ser 1 self-study library (Phase 4) — station-authenticated, no
   * claimed student or live session required to browse (see
   * study-modules.controller.ts's doc comment); starting an exercise from
   * it still needs a claimed student, same as My Assignments. */
  studyLibrary: (token: string | null) =>
    stationFetch<
      Array<{
        id: string;
        title: string;
        /** The teacher's guidance on how to use this module to prepare. */
        description: string | null;
        exercises: Array<{ id: string; title: string; type: string }>;
        /** Files the teacher uploaded to the module — streamed from `/media-assets/:id/file`. */
        materials: Array<{ id: string; title: string; filename: string; kind: string; mimeType: string; sizeBytes: number }>;
      }>
    >('/study-modules/library', token),

  /** Loose library files the teacher switched on for students (not attached
   * to any module) — same station auth as `studyLibrary`. `folder` is the
   * teacher's Study Library folder it is filed in (null = none). */
  studyLibraryFiles: (token: string | null) =>
    stationFetch<
      Array<{ id: string; title: string; filename: string; kind: string; mimeType: string; sizeBytes: number; folder?: { id: string; name: string } | null }>
    >(
      '/study-modules/library/files',
      token,
    ),

  /** <audio src> can't send an Authorization header, so authenticated
   * audio (a student's own recording) is fetched as a blob and played from
   * an object URL. The caller owns revoking it (URL.revokeObjectURL). */
  fetchBlobUrl: async (token: string | null, path: string): Promise<string> => {
    const { serverUrl } = getRuntimeConfig();
    const res = await fetch(`${serverUrl}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },

  /** On-demand model voice + IPA for one word (student practice, and a
   * test's "hear the word" button when the teacher allows it). Either half
   * can come back null on a server without eSpeak-NG/Piper — see SpeakResult. */
  speakPronunciation: (token: string | null, text: string, voice: PronunciationVoice) =>
    stationFetch<SpeakResult>('/pronunciation/speak', token, { method: 'POST', body: JSON.stringify({ text, voice }) }),

  /** Teacher-authored pronunciation exercises a student may practise
   * without an assignment. */
  pronunciationExercises: (token: string | null) =>
    stationFetch<Array<{ id: string; title: string; sourceText: string }>>('/pronunciation/practice-exercises', token),

  submitAttempt: (
    token: string | null,
    attemptId: string,
    body: { response: unknown; itemResponses?: Array<{ itemId: string; given: string }> },
  ) => stationFetch(`/attempts/${attemptId}/submit`, token, { method: 'POST', body: JSON.stringify(body) }),

  /** Offline dictionary (SPEC-offline-dictionary.md §5/§6) — `dictionaryMeta`
   * always returns 200 (the About screen renders even when unavailable);
   * the other three surface a 403 `DICTIONARY_DISABLED` (teacher turned it
   * off for this activity) or a 503 `DICTIONARY_UNAVAILABLE` as an
   * ApiError with `.code` set, which DictionaryPanel reads to pick its
   * error state rather than showing a raw network error (spec §6.3). */
  dictionaryMeta: (token: string | null) => stationFetch<DictionaryMeta>('/dictionary/meta', token),

  dictionaryLookup: (token: string | null, q: string) =>
    stationFetch<DictionaryLookupResult>(`/dictionary/lookup?q=${encodeURIComponent(q)}`, token),

  dictionarySuggest: (token: string | null, q: string, limit = 8) =>
    stationFetch<string[]>(`/dictionary/suggest?q=${encodeURIComponent(q)}&limit=${limit}`, token),

  dictionarySearch: (token: string | null, q: string, limit = 20) =>
    stationFetch<string[]>(`/dictionary/search?q=${encodeURIComponent(q)}&limit=${limit}`, token),
};
