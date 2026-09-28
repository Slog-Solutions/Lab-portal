import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityType, AttemptStatus, resolveDictionaryEnabled } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { EnvConfig } from '../../config/env.validation';

export type DictionaryPrincipal = { kind: 'staff' } | { kind: 'station'; stationId: string };

const DICTIONARY_DISABLED_MESSAGE = 'Dictionary is turned off for this activity';
const POLICY_CACHE_TTL_MS = 1_000;

/**
 * Server-side enforcement of the teacher control (spec §7): "The server
 * MUST also reject lookups from a station whose current activity has it
 * disabled — client-side hiding alone is not enforcement." Applied by
 * DictionaryAccessGuard in front of lookup/suggest/search.
 *
 * Two independent checks, either of which can block a station:
 *  (a) a LIVE-SESSION group activity with dictionaryEnabled=false
 *      (mirrors SessionStateService.getDesiredState's own
 *      "active session member" query, so the two never disagree about
 *      which activity is "current" for a seat);
 *  (b) an assignment-based VOCABULARY_TEST (or other exercise) the
 *      currently-signed-in student started IN_PROGRESS within the last
 *      DICTIONARY_TEST_WINDOW_MIN minutes — the live-session check alone
 *      would miss a self-paced Assignment test entirely (design decision,
 *      2026-09-28: assignment-based tests are in scope too).
 */
@Injectable()
export class DictionaryPolicyService {
  private readonly cache = new Map<string, { allowed: boolean; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async assertAllowed(principal: DictionaryPrincipal): Promise<void> {
    if (principal.kind === 'staff') return;

    const cached = this.cache.get(principal.stationId);
    const allowed = cached && cached.expiresAt > Date.now() ? cached.allowed : await this.resolveAndCache(principal.stationId);
    if (!allowed) {
      throw new ForbiddenException({ message: DICTIONARY_DISABLED_MESSAGE, code: 'DICTIONARY_DISABLED' });
    }
  }

  private async resolveAndCache(stationId: string): Promise<boolean> {
    const allowed = await this.resolve(stationId);
    this.cache.set(stationId, { allowed, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
    return allowed;
  }

  private async resolve(stationId: string): Promise<boolean> {
    // (a) Live-session group activity — same where-clause shape as
    // SessionStateService.getDesiredState, so "what's this seat's current
    // activity" is answered identically in both places.
    const member = await this.prisma.sessionMember.findFirst({
      where: { stationId, group: { session: { state: { in: ['ARMED', 'RUNNING', 'PAUSED'] } } } },
      include: { group: { include: { activity: true } } },
    });
    if (member?.group.activity) {
      const activity = member.group.activity;
      if (!resolveDictionaryEnabled(activity.type as ActivityType, activity.dictionaryEnabled)) {
        return false;
      }
    }

    // (b) Assignment-based (self-paced) test in progress for whoever is
    // currently signed in at this seat.
    const station = await this.prisma.station.findUnique({ where: { id: stationId }, select: { currentUserId: true } });
    if (station?.currentUserId) {
      const windowMin = this.config.get('DICTIONARY_TEST_WINDOW_MIN', { infer: true });
      const cutoff = new Date(Date.now() - windowMin * 60_000);
      const attempt = await this.prisma.attempt.findFirst({
        where: { studentId: station.currentUserId, status: AttemptStatus.IN_PROGRESS, startedAt: { gte: cutoff } },
        include: { exercise: true },
        orderBy: { startedAt: 'desc' },
      });
      if (attempt && !resolveDictionaryEnabled(attempt.exercise.type as ActivityType, attempt.exercise.dictionaryEnabled)) {
        return false;
      }
    }

    return true;
  }
}
