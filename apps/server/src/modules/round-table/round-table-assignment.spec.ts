import { describe, expect, it } from 'vitest';
import {
  AssignmentError,
  groupCountFor,
  inSeatOrder,
  nextInRotation,
  pickChairman,
  shuffle,
  splitIntoGroups,
} from './round-table-assignment';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `st${i + 1}`);
const seats = (n: number) => ids(n).map((stationId, i) => ({ stationId, seatNo: i + 2 }));

describe('splitIntoGroups (RT-5, participants)', () => {
  it('20 stations at size 5 -> 4 groups of 5', () => {
    const groups = splitIntoGroups(ids(20), 5);
    expect(groups.map((g) => g.length)).toEqual([5, 5, 5, 5]);
    expect(groups.flat().sort()).toEqual(ids(20).sort()); // everyone exactly once
  });

  it('group sizes never differ by more than one', () => {
    for (let n = 2; n <= 40; n++) {
      for (const size of [2, 3, 4, 5, 6, 10]) {
        const sizes = splitIntoGroups(ids(n), size).map((g) => g.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('caps at 6 groups by default and honours a tighter cap', () => {
    expect(splitIntoGroups(ids(40), 2)).toHaveLength(6);
    expect(splitIntoGroups(ids(40), 2, 3)).toHaveLength(3);
  });

  it('every group has at least 2 members, whatever the target size', () => {
    for (let n = 2; n <= 40; n++) {
      for (const size of [2, 3, 5, 10]) {
        expect(Math.min(...splitIntoGroups(ids(n), size).map((g) => g.length))).toBeGreaterThanOrEqual(2);
      }
    }
    // 5 students at size 2 would naively be 3 groups (2,2,1); it must be 2 groups (3,2).
    expect(splitIntoGroups(ids(5), 2).map((g) => g.length).sort()).toEqual([2, 3]);
  });

  it('rejects fewer than 2 eligible stations with a clear error', () => {
    expect(() => splitIntoGroups(ids(1), 4)).toThrow(AssignmentError);
    expect(() => splitIntoGroups([], 4)).toThrow(/at least 2/);
  });

  it('is driven by the injectable RNG (deterministic under a pinned one)', () => {
    const pinned = () => 0;
    expect(splitIntoGroups(ids(4), 2, 6, pinned)).toEqual(splitIntoGroups(ids(4), 2, 6, pinned));
  });

  it('does not mutate the input', () => {
    const input = ids(6);
    splitIntoGroups(input, 3);
    expect(input).toEqual(ids(6));
  });
});

describe('groupCountFor / shuffle', () => {
  it('min(maxGroups, ceil(n/size), floor(n/2))', () => {
    expect(groupCountFor(20, 5, 6)).toBe(4);
    expect(groupCountFor(41, 2, 6)).toBe(6);
    expect(groupCountFor(3, 5, 6)).toBe(1);
    expect(groupCountFor(5, 2, 6)).toBe(2);
  });

  it('shuffle keeps every element and actually reorders (over many draws)', () => {
    const input = ids(10);
    const out = shuffle(input);
    expect([...out].sort()).toEqual([...input].sort());
    const orders = new Set(Array.from({ length: 20 }, () => shuffle(input).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('pickChairman (RT-5, chairman)', () => {
  const all = () => true;

  it("'rotate' starts with the first member in seat order", () => {
    const members = [
      { stationId: 'c', seatNo: 9 },
      { stationId: 'a', seatNo: 3 },
      { stationId: 'b', seatNo: 5 },
    ];
    expect(pickChairman(members, all, 'rotate')).toBe('a');
  });

  it("'random' picks a member of the group", () => {
    const members = seats(5);
    for (let i = 0; i < 30; i++) expect(members.map((m) => m.stationId)).toContain(pickChairman(members, all, 'random'));
  });

  it('prefers an online member, and falls back to anyone when nobody is online', () => {
    const members = seats(3);
    expect(pickChairman(members, (id) => id === 'st3', 'random')).toBe('st3');
    expect(pickChairman(members, (id) => id === 'st3', 'rotate')).toBe('st3');
    expect(pickChairman(members, () => false, 'rotate')).toBe('st1');
  });

  it('seatless stations sort last', () => {
    const ordered = inSeatOrder([{ stationId: 'x', seatNo: null }, { stationId: 'y', seatNo: 4 }]);
    expect(ordered.map((m) => m.stationId)).toEqual(['y', 'x']);
  });
});

describe('nextInRotation', () => {
  const members = seats(4);

  it('walks seat order and wraps', () => {
    expect(nextInRotation(members, 'st1', () => true)).toBe('st2');
    expect(nextInRotation(members, 'st4', () => true)).toBe('st1');
  });

  it('skips offline members', () => {
    expect(nextInRotation(members, 'st1', (id) => id === 'st4')).toBe('st4');
  });

  it('returns null when nobody else is online, and never returns the current chairman', () => {
    expect(nextInRotation(members, 'st1', (id) => id === 'st1')).toBeNull();
    expect(nextInRotation(seats(1), 'st1', () => true)).toBeNull();
  });
});
