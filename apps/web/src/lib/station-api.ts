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
    // still tell a 429 or a coded failure apart from a plain message.
    throw new ApiError(res.status, body.message ?? res.statusText, typeof body.code === 'string' ? body.code : undefined);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface StartedAttempt {
  attemptId: string;
  exercise: { id: string; type: string; title: string; config: unknown };
  items?: Array<{ id: string; prompt: string; choices: string[]; mediaAssetId?: string }>;
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
        exercise: { id: string; title: string; type: string };
        /** Where the assignment came from — `className` is set only when the
         * assigning teacher teaches exactly one of the student's classes. */
        source: { teacherName: string; className: string | null };
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

  startAttempt: (token: string | null, body: { exerciseId: string; assignmentId?: string }) =>
    stationFetch<StartedAttempt>('/attempts/start', token, { method: 'POST', body: JSON.stringify(body) }),

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
   * to any module) — same station auth as `studyLibrary`. */
  studyLibraryFiles: (token: string | null) =>
    stationFetch<Array<{ id: string; title: string; filename: string; kind: string; mimeType: string; sizeBytes: number }>>(
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
};
