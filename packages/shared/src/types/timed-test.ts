import type { TestRevealDetail, TestRevealMode, VocabularyTestConfig } from '../schemas/index.js';

/**
 * SPEC-mcq-test-timed-reveal.md — the timed-reveal contract shared between
 * server and client. Kept in its own file, same as dictionary.ts and
 * desired-state.ts, since none of this is large enough to earn its own
 * package subpath.
 */

export const TEST_ERROR_CODES = {
  TEST_CLOSED: 'TEST_CLOSED',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  TEST_NOT_STARTED: 'TEST_NOT_STARTED',
} as const;
export type TestErrorCode = (typeof TEST_ERROR_CODES)[keyof typeof TEST_ERROR_CODES];

/**
 * §5.3 — included in the station's desired-state snapshot for the running
 * activity. All times are absolute epoch ms (server clock), never a
 * duration — `DesiredStationState.lock.expiresAt` uses the same
 * convention, for the same reason: a client's own clock must never be
 * trusted for "how long is left".
 *
 * `status` distinguishes an armed-but-not-yet-started test (no closesAt
 * yet, even for a timed one) from a running one, so the client doesn't
 * have to infer "not started" from a null closesAt that could otherwise
 * also mean "untimed".
 */
export interface TimedTestState {
  activityInstanceId: string;
  title: string;
  status: 'READY' | 'OPEN' | 'CLOSED';
  /** Set once the session actually starts (RUNNING). Null while ARMED. */
  startedAt: number | null;
  /** Absolute epoch ms, server-computed. Null for an untimed test. */
  closesAt: number | null;
  /** For client clock-skew correction: skew = serverNow - clientNowAtReceipt. */
  serverNow: number;
  revealed: boolean;
  revealMode: TestRevealMode;
  revealDetail: TestRevealDetail;
  allowReview: boolean;
}

/** GET /attempts/:id/result. `OPEN` means the attempt is still IN_PROGRESS
 * (only reachable by the owning student re-fetching their own in-progress
 * attempt — there is nothing to show beyond "still open"). */
export type AttemptResultView =
  | { status: 'OPEN' }
  | { status: 'WAITING'; awaiting: 'TIME' | 'TEACHER'; closesAt: number | null; serverNow: number }
  | {
      status: 'RELEASED';
      rawScore: number | null;
      maxScore: number | null;
      revealDetail: TestRevealDetail;
      items: Array<{
        itemId: string;
        prompt: string;
        /** Options in the order this student saw them. Empty for a
         * short-answer item. */
        choices: string[];
        given: string;
        /** Present only at SCORE_AND_FLAGS/FULL_ANSWERS. */
        correct?: boolean | null;
        /** Present only at FULL_ANSWERS. */
        correctAnswer?: string;
        explanation?: string;
      }>;
    };

/** Resolves the *effective* policy for a config that may predate this
 * spec — see zVocabularyTestConfig's own comment on why the fields are
 * optional rather than zod-defaulted. A legacy config (no reveal fields at
 * all) keeps today's behaviour: score-only, revealed on submit, exactly
 * like `VocabularyTestPlayer` showing a percentage the instant it submits. */
export function resolveTestPolicy(
  cfg: Pick<VocabularyTestConfig, 'revealMode' | 'revealDetail' | 'allowReview' | 'timeLimitSec'>,
): { revealMode: TestRevealMode; revealDetail: TestRevealDetail; allowReview: boolean; oneShot: boolean } {
  const revealMode: TestRevealMode = cfg.revealMode ?? (cfg.timeLimitSec ? 'ON_TIME_EXPIRY' : 'ON_SUBMIT');
  // FULL_ANSWERS for any config that shows a sign of being authored
  // through this spec (an explicit reveal field, or a time limit);
  // SCORE_ONLY only for a genuinely untouched legacy config (neither).
  const revealDetail: TestRevealDetail = cfg.revealDetail ?? (cfg.revealMode || cfg.timeLimitSec ? 'FULL_ANSWERS' : 'SCORE_ONLY');
  return {
    revealMode,
    revealDetail,
    allowReview: cfg.allowReview ?? true,
    // A retryable practice test (ON_SUBMIT, the legacy default) stays
    // retryable; a real timed/teacher-released test is one attempt.
    oneShot: revealMode !== 'ON_SUBMIT',
  };
}
