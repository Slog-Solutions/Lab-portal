import { useRef, useState } from 'react';

/**
 * Local answer buffer for a vocabulary test attempt (§8.1 "Answers buffer
 * locally; a disconnect must not lose them"). Every click updates state and
 * localStorage immediately (survives a reload/crash before the network
 * request even lands) and queues a save; saves are single-flight — never
 * two PUTs in the air at once — with the latest answers always winning: an
 * edit made while a save is in flight is queued and sent as soon as the
 * current one finishes, not lost.
 *
 * localStorage is scoped to `attemptId` alone — a fresh cuid per attempt,
 * never reused, so it can never resume a different student's (or a
 * different attempt's) answers even on a shared seat.
 */
export function useAnswerBuffer(
  attemptId: string,
  initial: Record<string, string>,
  save: (patch: Array<{ itemId: string; given: string }>) => Promise<unknown>,
): { answers: Record<string, string>; setAnswer: (itemId: string, given: string) => void } {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(`vt:${attemptId}`);
      if (raw) return { ...initial, ...(JSON.parse(raw) as Record<string, string>) };
    } catch {
      /* private window / blocked storage — fall through to the server's own initial answers */
    }
    return initial;
  });
  const pendingRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef(false);

  function persistLocal(next: Record<string, string>): void {
    try {
      localStorage.setItem(`vt:${attemptId}`, JSON.stringify(next));
    } catch {
      /* best-effort only — the in-memory state is still correct this session */
    }
  }

  function flush(): void {
    if (inFlightRef.current) return;
    const entries = Object.entries(pendingRef.current);
    if (entries.length === 0) return;
    const toSend = pendingRef.current;
    pendingRef.current = {};
    inFlightRef.current = true;
    save(entries.map(([itemId, given]) => ({ itemId, given })))
      .catch(() => {
        // Requeue the failed batch under whatever accumulated during the
        // flight — newer edits (already in pendingRef.current) win over
        // the stale ones being retried.
        pendingRef.current = { ...toSend, ...pendingRef.current };
      })
      .finally(() => {
        inFlightRef.current = false;
        if (Object.keys(pendingRef.current).length > 0) flush();
      });
  }

  function setAnswer(itemId: string, given: string): void {
    setAnswers((prev) => {
      const next = { ...prev, [itemId]: given };
      persistLocal(next);
      return next;
    });
    pendingRef.current[itemId] = given;
    flush();
  }

  return { answers, setAnswer };
}
