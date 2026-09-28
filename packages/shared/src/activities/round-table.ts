import { zRoundTableConfig, type RoundTableConfig } from './definitions.js';

/**
 * Round Table (Ser 3) setup rules shared by the teacher's authoring form and
 * the server, so the preview a teacher sees and the groups the server builds
 * at arm time come from ONE implementation. No Node or React imports.
 */

/** A session has at most this many groups (`zCreateGroupDto.index` is 1..6). */
export const MAX_SESSION_GROUPS = 6;

/**
 * How many groups `n` eligible students split into:
 * min(maxGroups, ceil(n / targetSize), floor(n / 2)). The last term is what
 * guarantees every group has at least 2 members.
 */
export function groupCountFor(n: number, targetSize: number, maxGroups: number = MAX_SESSION_GROUPS): number {
  return Math.max(1, Math.min(maxGroups, Math.ceil(n / targetSize), Math.floor(n / 2)));
}

/** The group sizes an automatic split of `n` students produces (round-robin
 * dealing, so sizes differ by at most one), largest first. Empty when fewer
 * than 2 students — a discussion needs someone to talk to. */
export function previewGroupSizes(n: number, targetSize: number, maxGroups: number = MAX_SESSION_GROUPS): number[] {
  if (n < 2 || targetSize < 2) return [];
  const count = groupCountFor(n, targetSize, maxGroups);
  return Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0));
}

export type RoundTableSetupResult = { ok: true; config: RoundTableConfig } | { ok: false; errors: string[] };

/**
 * Validates one Round Table group as authored (spec 7.1): the config parses
 * (defaults materialised), every group has at least 2 participants, a manual
 * chairman is exactly one of them, automatic grouping brings an automatic
 * chairman and a target size, and a rotating chair has an interval.
 */
export function validateRoundTableSetup(input: {
  config: unknown;
  memberStationIds: readonly string[];
  chairmanStationId?: string | undefined;
}): RoundTableSetupResult {
  const parsed = zRoundTableConfig.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)) };
  }
  const c = parsed.data;
  const errors: string[] = [];
  if (input.memberStationIds.length < 2) errors.push('a Round Table needs at least 2 participants');
  if (c.participantAssignment === 'automatic') {
    if (!c.targetGroupSize) errors.push('automatic grouping needs a target group size');
    if (c.chairmanAssignment !== 'automatic') {
      errors.push('automatic grouping needs an automatic chairman (change it after arming if needed)');
    }
  }
  if (c.chairmanAssignment === 'manual' && (!input.chairmanStationId || !input.memberStationIds.includes(input.chairmanStationId))) {
    errors.push("pick exactly one chairman from the group's members");
  }
  if (c.chairmanAssignment === 'automatic' && c.chairmanStrategy === 'rotate' && !c.rotateEverySec) {
    errors.push('rotating the chair needs an interval (at least 60 seconds)');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config: c };
}
