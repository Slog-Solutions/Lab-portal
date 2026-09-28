/**
 * Pure summary maths for the Round Table review page (spec 7.3): how long
 * each seat spoke, and who never took the floor at all. Kept free of Nest and
 * Prisma so it is unit-testable and the same inputs always give the same page.
 */

export interface ReviewTurn {
  stationId: string | null;
  studentId: string | null;
  teacherUserId: string | null;
  role: 'CHAIRMAN' | 'MEMBER' | 'TEACHER';
  startMs: number;
  endMs: number;
}

export interface SpeakingTotal {
  stationId: string;
  /** Sum of this seat's own turns (chairman voice turns + floor turns). */
  speakingMs: number;
  turns: number;
  /** No turn of any kind — "never took the floor". */
  neverSpoke: boolean;
}

export function summariseTurns(
  memberStationIds: readonly string[],
  turns: readonly ReviewTurn[],
): { totals: SpeakingTotal[]; teacherMs: number } {
  const byStation = new Map<string, SpeakingTotal>(
    memberStationIds.map((stationId) => [stationId, { stationId, speakingMs: 0, turns: 0, neverSpoke: true }]),
  );
  let teacherMs = 0;
  for (const turn of turns) {
    const ms = Math.max(0, turn.endMs - turn.startMs);
    if (turn.role === 'TEACHER') {
      teacherMs += ms;
      continue;
    }
    // A turn from a seat no longer in the roster is still real history: keep it.
    const total = byStation.get(turn.stationId ?? '') ?? (turn.stationId ? { stationId: turn.stationId, speakingMs: 0, turns: 0, neverSpoke: true } : null);
    if (!total) continue;
    total.speakingMs += ms;
    total.turns += 1;
    total.neverSpoke = false;
    byStation.set(total.stationId, total);
  }
  return { totals: Array.from(byStation.values()), teacherMs };
}
