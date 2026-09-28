import { randomInt } from 'node:crypto';
import { MAX_SESSION_GROUPS, groupCountFor } from '@lab/shared/activities';

// One implementation of the count maths, shared with the teacher's authoring
// preview (packages/shared) so what a teacher sees is what arm builds.
export { MAX_SESSION_GROUPS, groupCountFor };

/**
 * Pure helpers for Round Table's automatic assignment (Ser 3: "chairmen and
 * participants ... defined either manually or with automatic options").
 * Deliberately free of Nest/Prisma so the maths is unit-testable: the
 * service feeds it the pool and persists the result. Randomness is a CSPRNG
 * (node:crypto) and is injectable, so tests can pin an outcome.
 */

export class AssignmentError extends Error {}

export type RandomInt = (maxExclusive: number) => number;

const csprng: RandomInt = (n) => randomInt(n);

/** Fisher–Yates over a copy; unbiased because randomInt is. */
export function shuffle<T>(items: readonly T[], rand: RandomInt = csprng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Shuffles `eligible` and deals it round-robin into groups, so sizes differ
 * by at most one and no group has fewer than two. Throws when fewer than two
 * students are eligible — a discussion needs somebody to talk to.
 */
export function splitIntoGroups<T>(
  eligible: readonly T[],
  targetSize: number,
  maxGroups: number = MAX_SESSION_GROUPS,
  rand: RandomInt = csprng,
): T[][] {
  if (eligible.length < 2) {
    throw new AssignmentError(
      `Automatic grouping needs at least 2 signed-in, online students; only ${eligible.length} qualified`,
    );
  }
  const count = groupCountFor(eligible.length, targetSize, maxGroups);
  const groups: T[][] = Array.from({ length: count }, () => []);
  shuffle(eligible, rand).forEach((item, i) => groups[i % count]!.push(item));
  return groups;
}

export interface Seat {
  stationId: string;
  seatNo: number | null;
}

/** Members in seat order (seatless stations last, ties broken by id). */
export function inSeatOrder<T extends Seat>(members: readonly T[]): T[] {
  return [...members].sort(
    (a, b) => (a.seatNo ?? Infinity) - (b.seatNo ?? Infinity) || a.stationId.localeCompare(b.stationId),
  );
}

/**
 * Initial chairman for a group. `random` picks any member; `rotate` starts at
 * the first member in seat order. Online members are preferred either way;
 * when nobody is online the whole group is the pool, so arming never fails on
 * a chairman.
 */
export function pickChairman(
  members: readonly Seat[],
  isOnline: (stationId: string) => boolean,
  strategy: 'random' | 'rotate',
  rand: RandomInt = csprng,
): string {
  if (members.length === 0) throw new AssignmentError('A group needs at least one member to pick a chairman');
  const ordered = inSeatOrder(members);
  const online = ordered.filter((m) => isOnline(m.stationId));
  const pool = online.length > 0 ? online : ordered;
  return (strategy === 'rotate' ? pool[0]! : pool[rand(pool.length)]!).stationId;
}

/**
 * The member who chairs next: the next ONLINE member after `current` in seat
 * order, wrapping around, never `current` itself. Null when no one else is online.
 */
export function nextInRotation(
  members: readonly Seat[],
  current: string,
  isOnline: (stationId: string) => boolean,
): string | null {
  const ids = inSeatOrder(members).map((m) => m.stationId);
  const start = ids.indexOf(current);
  for (let i = 1; i <= ids.length; i++) {
    const candidate = ids[(start + i) % ids.length];
    if (candidate && candidate !== current && isOnline(candidate)) return candidate;
  }
  return null;
}
