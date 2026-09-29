import { apiFetch } from './api-client';

/** SPEC-mcq-test-timed-reveal.md §6.1/§6.5 — "Launch in lab" and the
 * teacher's live overrides. Mirrors TimedTestsController's routes. */

export interface LaunchTestResult {
  sessionId: string;
  activityInstanceId: string | null;
}

export type TestBoardRowStatus = 'NOT_STARTED' | 'ANSWERING' | 'SUBMITTED';

export interface TestBoardRow {
  stationId: string;
  seatNo: number | null;
  studentName: string | null;
  status: TestBoardRowStatus;
  answered: number;
  total: number;
  rawScore: number | null;
  maxScore: number | null;
}

export interface TestBoard {
  activityInstanceId: string;
  title: string;
  status: 'READY' | 'OPEN' | 'CLOSED';
  revealed: boolean;
  closesAt: number | null;
  serverNow: number;
  rows: TestBoardRow[];
}

export const timedTestsApi = {
  launch: (dto: { exerciseId: string; batchId: string; expectedStudents: Record<string, string> }) =>
    apiFetch<LaunchTestResult>('/activity-instances/launch', { method: 'POST', body: JSON.stringify(dto) }),
  board: (instanceId: string) => apiFetch<TestBoard>(`/activity-instances/${instanceId}/board`),
  revealNow: (instanceId: string) => apiFetch<{ ok: true }>(`/activity-instances/${instanceId}/reveal-now`, { method: 'POST' }),
  extend: (instanceId: string, seconds: number) =>
    apiFetch<{ ok: true; closesAt: number }>(`/activity-instances/${instanceId}/extend`, { method: 'POST', body: JSON.stringify({ seconds }) }),
  close: (instanceId: string) => apiFetch<{ ok: true }>(`/activity-instances/${instanceId}/close`, { method: 'POST' }),
  release: (instanceId: string) => apiFetch<{ ok: true }>(`/activity-instances/${instanceId}/release`, { method: 'POST' }),
};
