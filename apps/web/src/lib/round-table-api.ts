import type { RoundTableFloor, SessionRole } from '@lab/shared';
import { apiFetch } from './api-client';

/** One row of the teacher monitor: everything needed to draw a Round Table
 * group before its first live `rt:floor` arrives. */
export interface RoundTableGroupOverview {
  groupId: string;
  index: number;
  topic: string;
  config: {
    chairmanAssignment: 'manual' | 'automatic';
    micRequestQueueEnabled: boolean;
    maxTurnSec?: number;
    chairmanStrategy: 'random' | 'rotate';
    rotateEverySec?: number;
  } | null;
  /** Null until the session is armed (and again once it has ended). */
  floor: RoundTableFloor | null;
  members: Array<{
    stationId: string;
    seatNo: number | null;
    studentName: string | null;
    role: SessionRole;
    online: boolean;
  }>;
}

export interface RoundTableReviewTurn {
  stationId: string | null;
  studentId: string | null;
  teacherUserId: string | null;
  role: 'CHAIRMAN' | 'MEMBER' | 'TEACHER';
  startMs: number;
  endMs: number;
}

export interface RoundTableReview {
  groupId: string;
  topic: string;
  members: Array<{ stationId: string; seatNo: number | null; studentName: string | null }>;
  turns: RoundTableReviewTurn[];
  totals: Array<{ stationId: string; speakingMs: number; turns: number; neverSpoke: boolean }>;
  teacherMs: number;
  recordings: Array<{ id: string; stationId: string | null; status: string; durationMs: number | null; offsetMs: number | null }>;
}

export interface RoundTableOverview {
  sessionId: string;
  title: string;
  state: 'DRAFT' | 'ARMED' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'ABANDONED';
  groups: RoundTableGroupOverview[];
}

/** What listen/participate hand back: a token for the group's room. */
export interface RoundTableJoin {
  room: string;
  token: string;
  identity: string;
}

const base = (sessionId: string, groupId: string) => `/sessions/${sessionId}/groups/${groupId}/round-table`;
const post = <T = void>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** Thin wrappers over the teacher-side Round Table routes (apps/server
 * RoundTableController) — one function per action so pages never hand-build
 * a URL. Every route re-checks that the caller teaches this session's batch. */
export const roundTableApi = {
  overview: (sessionId: string) => apiFetch<RoundTableOverview>(`/sessions/${sessionId}/round-table`),
  /** Subscribe-only; the group's students see "Teacher is listening". */
  listen: (sessionId: string, groupId: string) => post<RoundTableJoin>(`${base(sessionId, groupId)}/listen`),
  /** Same room with the mic allowed; students see "Teacher has joined". */
  participate: (sessionId: string, groupId: string) => post<RoundTableJoin>(`${base(sessionId, groupId)}/participate`),
  leave: (sessionId: string, groupId: string) => post(`${base(sessionId, groupId)}/leave`),
  grant: (sessionId: string, groupId: string, stationId: string) => post(`${base(sessionId, groupId)}/grant`, { stationId }),
  revoke: (sessionId: string, groupId: string) => post(`${base(sessionId, groupId)}/revoke`),
  setChairman: (sessionId: string, groupId: string, stationId: string) =>
    post(`${base(sessionId, groupId)}/chairman`, { stationId }),
  muteAll: (sessionId: string, groupId: string) => post(`${base(sessionId, groupId)}/mute-all`),
  review: (sessionId: string, groupId: string) => apiFetch<RoundTableReview>(`${base(sessionId, groupId)}/review`),
};
