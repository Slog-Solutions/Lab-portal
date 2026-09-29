import { apiFetch } from './api-client';

/** The types the "Create Assignment" pages author. */
export type AssessmentType = 'VOCABULARY_TEST' | 'WRITING_TEST' | 'LISTENING_TEST' | 'READING_TEST';

/** SPEC-mcq-test-timed-reveal.md §5.1/§7.1. */
export type TestRevealMode = 'ON_TIME_EXPIRY' | 'ON_SUBMIT' | 'ON_TEACHER_RELEASE';
export type TestRevealDetail = 'SCORE_ONLY' | 'SCORE_AND_FLAGS' | 'FULL_ANSWERS';

/** The form-style builder's own question shape (§7.1) — `options[correctIndex]`
 * is the correct answer, matching zVocabQuestionInput. */
export interface VocabQuestionInput {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  mediaAssetId?: string;
}

export interface VocabTestSettings {
  timeLimitSec?: number;
  revealMode: TestRevealMode;
  revealDetail: TestRevealDetail;
  allowReview: boolean;
  sampleSize?: number;
}

export interface AssessmentSummary {
  id: string;
  type: AssessmentType;
  title: string;
  createdAt: string;
  teacherName: string;
  questionCount: number;
  assigned: number;
  submitted: number;
  /** Writing tests handed in but not marked yet; always 0 for the self-scoring types. */
  toGrade: number;
  /** Mean of each student's latest scored attempt, as a percentage. */
  averageScore: number | null;
  /** How many times this test has been launched in the lab. */
  labRunCount: number;
}

export interface AssessmentAttempt {
  id: string;
  status: string;
  rawScore: number | null;
  maxScore: number | null;
  submittedAt: string | null;
  /** Future timestamp (or null): "results visible from this instant". Only
   * meaningful for VOCABULARY_TEST — see AttemptsService's own comment on
   * Attempt.revealAt. Always in the past for every other assignment type. */
  revealAt: string | null;
  /** `given` is the student's answer — a writing test's essay, or a reading test's Recording id. */
  responses: Array<{ itemId: string; given: string; correct: boolean | null }>;
  override: { newScore: number; reason: string } | null;
}

/** A "Launch in lab" run of a vocabulary test — keyed by ActivityInstance,
 * not Assignment, so it never appears in `assignments[]` below. */
export interface LabRun {
  activityInstanceId: string;
  sessionId: string;
  sessionTitle: string;
  startedAt: string | null;
  status: 'READY' | 'OPEN' | 'CLOSED';
  closesAt: string | null;
  revealedAt: string | null;
  attempts: Array<{
    student: { id: string; fullName: string } | null;
    status: string;
    rawScore: number | null;
    maxScore: number | null;
    revealAt: string | null;
    answers: Record<string, string>;
  }>;
}

export interface AssessmentDetail {
  id: string;
  type: AssessmentType;
  title: string;
  createdAt: string;
  teacherName: string;
  config: { instructions?: string; minWords?: number; maxWords?: number; audioAssetId?: string; voice?: 'en_US' | 'en_GB' };
  /** VOCABULARY_TEST only. */
  settings?: VocabTestSettings;
  /** §7.1 — re-editable in the builder only while true (no attempts and no
   * lab run yet). Always true for a hand-marked type until it has attempts
   * too (setItems' own guard), but the builder itself only exists for vocab. */
  editable: boolean;
  /** `answer` is null for a writing prompt or a reading passage (there is no key). `mediaAssetId`
   * is set only for a reading test whose teacher uploaded a PDF (the student reads that instead of, or alongside, `prompt`).
   * `correctIndex`/`explanation` are set for VOCABULARY_TEST, for round-tripping into the builder. */
  questions: Array<{
    id: string;
    prompt: string;
    answer: string | null;
    choices: string[];
    mediaAssetId?: string;
    explanation?: string;
    correctIndex?: number;
  }>;
  assignments: Array<{
    assignmentId: string;
    dueAt: string | null;
    student: { id: string; fullName: string; serviceNumber: string };
    attempt: AssessmentAttempt | null;
  }>;
  /** VOCABULARY_TEST only — every "Launch in lab" run. */
  labRuns: LabRun[];
}

interface CommonInput {
  title: string;
  studentIds: string[];
  dueAt?: string;
  /** The class it is created from — files it in the students' class history. */
  batchId?: string;
  /** Offline dictionary (SPEC-offline-dictionary.md §7) — omitted means "use
   * the activity type's own default" (VOCABULARY_TEST off, else on). */
  dictionaryEnabled?: boolean;
}

export type CreateAssessmentInput =
  | (CommonInput & {
      type: 'VOCABULARY_TEST';
      /** Exactly one of these — the fast word-list import, or the form
       * builder's own questions. */
      wordListText?: string;
      questions?: VocabQuestionInput[];
      sampleSize?: number;
      timeLimitSec?: number;
      revealMode?: TestRevealMode;
      revealDetail?: TestRevealDetail;
      allowReview?: boolean;
    })
  | (CommonInput & { type: 'WRITING_TEST'; prompt: string; instructions?: string; minWords?: number; maxWords?: number })
  | (CommonInput & { type: 'LISTENING_TEST'; audioAssetId: string; instructions?: string; questionsText: string })
  | (CommonInput & { type: 'READING_TEST'; passage?: string; documentAssetId?: string; instructions?: string; voice?: 'en_US' | 'en_GB' });

/** PUT /assessments/:id — re-edit a saved vocabulary test (§7.1). Refused
 * (409) once `editable` is false. */
export interface UpdateVocabTestInput {
  title?: string;
  wordListText?: string;
  questions?: VocabQuestionInput[];
  sampleSize?: number;
  timeLimitSec?: number;
  revealMode?: TestRevealMode;
  revealDetail?: TestRevealDetail;
  allowReview?: boolean;
  dictionaryEnabled?: boolean;
}

export const assessmentsApi = {
  list: (type: AssessmentType) => apiFetch<AssessmentSummary[]>(`/assessments?type=${type}`),
  get: (id: string) => apiFetch<AssessmentDetail>(`/assessments/${id}`),
  create: (dto: CreateAssessmentInput) =>
    apiFetch<{ exerciseId: string; type: AssessmentType; questionCount: number; assigned: number }>('/assessments', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  update: (id: string, dto: UpdateVocabTestInput) => apiFetch<AssessmentDetail>(`/assessments/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  /** The ON_TEACHER_RELEASE manual step for the assignment/individual path
   * (a lab run's own release goes through timedTestsApi.release instead). */
  release: (id: string) => apiFetch<{ ok: true; released: number }>(`/assessments/${id}/release`, { method: 'POST' }),
  grade: (attemptId: string, dto: { score: number; feedback?: string }) =>
    apiFetch(`/assessments/attempts/${attemptId}/grade`, { method: 'POST', body: JSON.stringify(dto) }),
};
