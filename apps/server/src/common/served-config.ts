import { ActivityType } from '@lab/shared';

/**
 * Server-side only. Strips answer keys (and anything else a student
 * shouldn't hold in bulk) from an activity config before it leaves the
 * server — this is the ONE choke point every station-bound config must
 * pass through, whether it travels via a live-session snapshot
 * (`session:snapshot`) or an attempt-serve REST response
 * (`POST /attempts/start`). See SPEC-mcq-test-timed-reveal.md §3.2.
 *
 * A vocabulary test's `items[]`/`itemBankId` never reach a station this
 * way — the *questions themselves* only ever travel through
 * AttemptsService.prepareServe's per-attempt ServedItem[] (already
 * answer-stripped, and for bank mode, only the sampled subset). This
 * function only has to protect the settings-shaped remainder of the
 * config, which is safe to hand to every station regardless of what
 * that station's own attempt actually samples.
 */
export function projectConfigForStation(type: ActivityType, config: unknown): unknown {
  if (type !== ActivityType.VOCABULARY_TEST) return config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;

  const cfg = config as Record<string, unknown>;
  // Whitelist, not a strip-list — a field added to zVocabularyTestConfig
  // in the future is excluded by default, not leaked by default.
  const projected: Record<string, unknown> = {};
  for (const key of ['shuffleItems', 'sampleSize', 'timeLimitSec', 'revealMode', 'revealDetail', 'allowReview'] as const) {
    if (key in cfg) projected[key] = cfg[key];
  }
  return projected;
}
