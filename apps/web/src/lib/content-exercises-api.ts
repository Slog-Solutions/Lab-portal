import type { CreateContentExerciseDto } from '@lab/shared';
import { apiFetch } from './api-client';

export interface ContentExerciseRow {
  id: string;
  title: string;
  builtin: boolean;
  teacherName: string | null;
  createdAt: string;
  gradeLevel: string;
  cefrLevel: string | null;
  package: { id: string; title: string; publisher: string | null; format: string; entryPoint: string; description: string | null } | null;
  assigned: number;
  completedBy: number;
  average: number | null;
}

export interface ContentReportItem {
  itemId: string;
  correct: boolean;
  prompt?: string;
  given?: string;
  expected?: string;
}

export interface ContentReportRow {
  studentId: string;
  fullName: string;
  serviceNumber: string;
  dueAt: string | null;
  attempts: number;
  attempt: {
    id: string;
    status: string;
    packageScore: number | null;
    score: number | null;
    edited: { oldScore: number | null; reason: string; at: string } | null;
    startedAt: string;
    submittedAt: string | null;
    durationSec: number | null;
    items: ContentReportItem[];
  } | null;
}

export interface ContentReport {
  exercise: { id: string; title: string; gradeLevel: string; cefrLevel: string | null; package: { title: string; publisher: string | null } | null };
  summary: { students: number; completed: number; average: number | null };
  rows: ContentReportRow[];
}

export const contentExercisesApi = {
  list: () => apiFetch<ContentExerciseRow[]>('/content-exercises'),
  create: (dto: CreateContentExerciseDto) => apiFetch<{ id: string }>('/content-exercises', { method: 'POST', body: JSON.stringify(dto) }),
  launch: (id: string, dto: { batchId?: string; studentIds?: string[]; dueAt?: string; openNow: boolean }) =>
    apiFetch<{ students: number; created: number; skipped: number; openedOnSeats: number }>(`/content-exercises/${id}/launch`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  report: (id: string) => apiFetch<ContentReport>(`/content-exercises/${id}/report`),
};
