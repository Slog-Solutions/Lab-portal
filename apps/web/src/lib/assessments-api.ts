import { apiFetch } from './api-client';

/** The types the "Create Assignment" pages author. */
export type AssessmentType = 'VOCABULARY_TEST' | 'WRITING_TEST' | 'LISTENING_TEST' | 'READING_TEST';

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
}

export interface AssessmentAttempt {
  id: string;
  status: string;
  rawScore: number | null;
  maxScore: number | null;
  submittedAt: string | null;
  /** `given` is the student's answer — a writing test's essay, or a reading test's Recording id. */
  responses: Array<{ itemId: string; given: string; correct: boolean | null }>;
  override: { newScore: number; reason: string } | null;
}

export interface AssessmentDetail {
  id: string;
  type: AssessmentType;
  title: string;
  createdAt: string;
  teacherName: string;
  config: { instructions?: string; minWords?: number; maxWords?: number; audioAssetId?: string; voice?: 'en_US' | 'en_GB' };
  /** `answer` is null for a writing prompt or a reading passage (there is no key). `mediaAssetId`
   * is set only for a reading test whose teacher uploaded a PDF (the student reads that instead of, or alongside, `prompt`). */
  questions: Array<{ id: string; prompt: string; answer: string | null; choices: string[]; mediaAssetId?: string }>;
  assignments: Array<{
    assignmentId: string;
    dueAt: string | null;
    student: { id: string; fullName: string; serviceNumber: string };
    attempt: AssessmentAttempt | null;
  }>;
}

interface CommonInput {
  title: string;
  studentIds: string[];
  dueAt?: string;
  /** The class it is created from — files it in the students' class history. */
  batchId?: string;
}

export type CreateAssessmentInput =
  | (CommonInput & { type: 'VOCABULARY_TEST'; wordListText: string; sampleSize?: number })
  | (CommonInput & { type: 'WRITING_TEST'; prompt: string; instructions?: string; minWords?: number; maxWords?: number })
  | (CommonInput & { type: 'LISTENING_TEST'; audioAssetId: string; instructions?: string; questionsText: string })
  | (CommonInput & { type: 'READING_TEST'; passage?: string; documentAssetId?: string; instructions?: string; voice?: 'en_US' | 'en_GB' });

export const assessmentsApi = {
  list: (type: AssessmentType) => apiFetch<AssessmentSummary[]>(`/assessments?type=${type}`),
  get: (id: string) => apiFetch<AssessmentDetail>(`/assessments/${id}`),
  create: (dto: CreateAssessmentInput) =>
    apiFetch<{ exerciseId: string; type: AssessmentType; questionCount: number; assigned: number }>('/assessments', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  grade: (attemptId: string, dto: { score: number; feedback?: string }) =>
    apiFetch(`/assessments/attempts/${attemptId}/grade`, { method: 'POST', body: JSON.stringify(dto) }),
};
