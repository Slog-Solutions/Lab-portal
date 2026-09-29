import { useEffect, useRef, useState } from 'react';
import { useNow } from '../../../lib/use-now';

export interface TestClockInput {
  /** Absolute epoch ms the test closes at, or null for an untimed test. */
  closesAt: number | null;
  /** The server's own clock at the moment this value was received — used
   * to compute `skew`, so a station's own wrong OS clock can never affect
   * the countdown (SPEC-mcq-test-timed-reveal.md §5.3/§8.1, and the
   * "Clock" acceptance test: a station 30 minutes fast still reveals at
   * the correct moment). */
  serverNow: number;
  /** When the countdown should start counting from, for the 20%-remaining
   * warning threshold — the attempt's own startedAt (individual) or the
   * instance's startedAt (cohort). Falls back to "just started now" if
   * absent, which only affects when the warning color kicks in, never the
   * deadline itself. */
  startedAt: number | null;
}

export interface TestClock {
  /** Milliseconds left, clamped to >= 0. null when untimed. */
  remainingMs: number | null;
  /** True in the last 20% of the total duration. Always false when untimed. */
  warn: boolean;
  /** True once remainingMs has reached 0 (and stays true). */
  expired: boolean;
  label: string;
}

/** Skew-corrected countdown — `skew = serverNow - clientNowAtReceipt` is
 * captured once per `closesAt`/`serverNow` pair (a fresh snapshot or a
 * fresh /attempts/start response), not recomputed every tick, so the
 * countdown is stable between updates and only re-anchors when the server
 * actually sends a new value (e.g. Extend). */
export function useTestClock(input: TestClockInput): TestClock {
  const skewRef = useRef(0);
  const anchorRef = useRef<{ closesAt: number | null; serverNow: number } | null>(null);
  if (!anchorRef.current || anchorRef.current.closesAt !== input.closesAt || anchorRef.current.serverNow !== input.serverNow) {
    skewRef.current = input.serverNow - Date.now();
    anchorRef.current = { closesAt: input.closesAt, serverNow: input.serverNow };
  }

  const now = useNow(input.closesAt !== null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (input.closesAt === null) return;
    const remaining = input.closesAt - (now + skewRef.current);
    if (remaining <= 0) setExpired(true);
  }, [now, input.closesAt]);

  if (input.closesAt === null) {
    return { remainingMs: null, warn: false, expired: false, label: '' };
  }

  const remainingMs = Math.max(0, input.closesAt - (now + skewRef.current));
  const total = input.closesAt - (input.startedAt ?? input.closesAt - remainingMs);
  const warn = total > 0 && remainingMs / total <= 0.2;
  const totalSec = Math.floor(remainingMs / 1000);
  const label = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;

  return { remainingMs, warn, expired: expired || remainingMs <= 0, label };
}
