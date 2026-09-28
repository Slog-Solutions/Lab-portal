import { describe, expect, it } from 'vitest';
import { summariseTurns, type ReviewTurn } from './round-table-review';

const turn = (over: Partial<ReviewTurn>): ReviewTurn => ({
  stationId: 'a', studentId: null, teacherUserId: null, role: 'MEMBER', startMs: 0, endMs: 1000, ...over,
});

describe('summariseTurns (spec 7.3)', () => {
  it('totals each seat and counts turns', () => {
    const { totals } = summariseTurns(['a', 'b'], [
      turn({ stationId: 'a', startMs: 0, endMs: 4000 }),
      turn({ stationId: 'a', startMs: 10_000, endMs: 12_500 }),
      turn({ stationId: 'b', startMs: 5000, endMs: 6000 }),
    ]);
    expect(totals.find((t) => t.stationId === 'a')).toMatchObject({ speakingMs: 6500, turns: 2, neverSpoke: false });
    expect(totals.find((t) => t.stationId === 'b')).toMatchObject({ speakingMs: 1000, turns: 1 });
  });

  it('flags a seat with no turns at all as never having taken the floor', () => {
    const { totals } = summariseTurns(['a', 'b', 'c'], [turn({ stationId: 'a' })]);
    expect(totals.filter((t) => t.neverSpoke).map((t) => t.stationId)).toEqual(['b', 'c']);
    expect(totals.every((t) => t.speakingMs >= 0)).toBe(true);
  });

  it('counts a chairman voice turn as speaking', () => {
    const { totals } = summariseTurns(['chair'], [turn({ stationId: 'chair', role: 'CHAIRMAN', startMs: 0, endMs: 30_000 })]);
    expect(totals[0]).toMatchObject({ speakingMs: 30_000, neverSpoke: false });
  });

  it('teacher time is tracked separately and never credited to a seat', () => {
    const { totals, teacherMs } = summariseTurns(['a'], [turn({ stationId: null, role: 'TEACHER', teacherUserId: 't', startMs: 1000, endMs: 9000 })]);
    expect(teacherMs).toBe(8000);
    expect(totals[0]).toMatchObject({ speakingMs: 0, neverSpoke: true });
  });

  it('keeps history for a seat that left the roster, and ignores negative spans', () => {
    const { totals } = summariseTurns(['a'], [turn({ stationId: 'gone', startMs: 0, endMs: 2000 }), turn({ stationId: 'a', startMs: 5000, endMs: 4000 })]);
    expect(totals.find((t) => t.stationId === 'gone')?.speakingMs).toBe(2000);
    expect(totals.find((t) => t.stationId === 'a')?.speakingMs).toBe(0);
  });
});
