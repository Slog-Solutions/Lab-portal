import { apiFetch } from './api-client';

export type PronunciationVoice = 'en_US' | 'en_GB';

/** Either half may be null when the offline pipeline (eSpeak-NG / Piper)
 * isn't installed on the server — `warnings` says which, and callers should
 * still work with whatever half did come back. */
export interface SpeakResult {
  ipa: string | null;
  audioBase64: string | null;
  warnings: string[];
}

export interface PronunciationExerciseSummary {
  id: string;
  title: string;
  createdAt: string;
  teacherName: string;
  config: { sourceText?: string; voice?: PronunciationVoice; ipaAssetId?: string; modelAudioAssetId?: string };
  assigned: number;
  submitted: number;
  reviewed: number;
}

export interface PronunciationTestSummary {
  id: string;
  title: string;
  createdAt: string;
  teacherName: string;
  wordCount: number;
  assigned: number;
  submitted: number;
  graded: number;
}

export interface PronunciationTestAttempt {
  id: string;
  status: string;
  rawScore: number | null;
  submittedAt: string | null;
  /** One per word: the student's Recording id and the teacher's 1-5 rating (null until graded). */
  responses: Array<{ itemId: string; recordingId: string; score: number | null }>;
  override: { newScore: number; reason: string } | null;
}

export interface PronunciationTestDetail {
  id: string;
  title: string;
  createdAt: string;
  config: { instructions?: string; playModelAudio?: boolean; voice?: PronunciationVoice };
  words: Array<{ id: string; word: string }>;
  assignments: Array<{
    assignmentId: string;
    dueAt: string | null;
    student: { id: string; fullName: string; serviceNumber: string };
    attempt: PronunciationTestAttempt | null;
  }>;
}

export interface CreatePronunciationTestInput {
  title: string;
  words: string[];
  instructions?: string;
  playModelAudio: boolean;
  voice: PronunciationVoice;
  studentIds: string[];
  dueAt?: string;
}

/** The one-step "author and send" form: a sentence, paragraph or single
 * word, the students, and an optional due date/class — no separate
 * generate-then-save step (see PronunciationService.createExercise). */
export interface CreatePronunciationExerciseInput {
  title: string;
  sourceText: string;
  voice: PronunciationVoice;
  studentIds: string[];
  dueAt?: string;
  batchId?: string;
}

/** Turns a /pronunciation/speak audio payload into a playable blob URL.
 * The caller owns revoking it (URL.revokeObjectURL) when done. */
export function base64ToAudioUrl(audioBase64: string, mimeType = 'audio/wav'): string {
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export const pronunciationApi = {
  status: () => apiFetch<{ ipa: boolean; voice: boolean }>('/pronunciation/status'),
  generate: (sourceText: string, voice: PronunciationVoice) =>
    apiFetch<{ ipaAssetId: string | null; modelAudioAssetId: string | null; warnings: string[] }>('/pronunciation/generate', {
      method: 'POST',
      body: JSON.stringify({ sourceText, voice }),
    }),
  /** Staff-side model voice (e.g. hearing the word while grading). The
   * student seat's equivalent is stationApi.speakPronunciation. */
  speak: (text: string, voice: PronunciationVoice) =>
    apiFetch<SpeakResult>('/pronunciation/speak', { method: 'POST', body: JSON.stringify({ text, voice }) }),

  exercises: {
    list: () => apiFetch<PronunciationExerciseSummary[]>('/pronunciation/exercises'),
    create: (dto: CreatePronunciationExerciseInput) =>
      apiFetch<{ exerciseId: string; title: string; assigned: number }>('/pronunciation/exercises', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
  },

  tests: {
    list: () => apiFetch<PronunciationTestSummary[]>('/pronunciation/tests'),
    get: (id: string) => apiFetch<PronunciationTestDetail>(`/pronunciation/tests/${id}`),
    create: (dto: CreatePronunciationTestInput) =>
      apiFetch<{ exerciseId: string; wordCount: number; assigned: number }>('/pronunciation/tests', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    grade: (attemptId: string, dto: { ratings: Array<{ itemId: string; score: number }>; feedback?: string }) =>
      apiFetch(`/pronunciation/tests/attempts/${attemptId}/grade`, { method: 'POST', body: JSON.stringify(dto) }),
  },
};
