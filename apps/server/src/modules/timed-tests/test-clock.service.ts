import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type CloseKind = 'EXPIRED' | 'REVEAL_NOW' | 'NO_REVEAL' | 'SESSION_ENDED';

/**
 * Pure Prisma operations on ActivityInstance.closesAt/closedAt (SPEC-mcq-test-timed-reveal.md
 * §6.2's close scheduler). Split out from TestCloseService (which also
 * grades attempts and pushes snapshots) into its own tiny module so
 * SessionsModule can depend on just this — SessionsService needs to set
 * closesAt when a session starts and claim a close on end()/pause(), but
 * the full close SEQUENCE needs AttemptsService and ControlGateway, which
 * would otherwise pull SessionsModule back into TimedTestsModule and
 * create a module cycle (Sessions -> TimedTests -> Sessions, for launch()
 * calling back into SessionsService.create/arm/start).
 */
@Injectable()
export class TestClockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sets closesAt = now + timeLimitSec on every linked, ON_TIME_EXPIRY
   * VOCABULARY_TEST instance in this session, the moment it actually
   * starts running (SessionsService.start, transitioning from ARMED).
   * Untimed tests (no timeLimitSec, or a different revealMode) are left
   * alone — closesAt stays null, same as "no deadline". */
  async onSessionStarted(sessionId: string, now: Date): Promise<void> {
    const instances = await this.prisma.activityInstance.findMany({
      where: { group: { sessionId }, exerciseId: { not: null } },
      include: { exercise: { select: { config: true } } },
    });
    for (const instance of instances) {
      const cfg = instance.exercise?.config as { timeLimitSec?: number; revealMode?: string } | undefined;
      if (!cfg?.timeLimitSec) continue;
      if (cfg.revealMode && cfg.revealMode !== 'ON_TIME_EXPIRY') continue;
      const closesAt = new Date(now.getTime() + cfg.timeLimitSec * 1000);
      await this.prisma.$transaction([
        this.prisma.activityInstance.update({ where: { id: instance.id }, data: { closesAt } }),
        this.prisma.attempt.updateMany({ where: { activityInstanceId: instance.id, status: 'IN_PROGRESS' }, data: { closesAt } }),
      ]);
    }
  }

  /** Idempotent claim: only the FIRST caller (the 5s sweep, Reveal now,
   * Close without reveal, or a session ending) to land here for a given
   * instance gets `true` back and should go on to run the close sequence
   * (TestCloseService.finalizeInstance); every later caller sees
   * `closedAt` already set, gets `false`, and does nothing further —
   * running the close sequence twice must not double-submit or
   * double-grade (§9 "Idempotency"). */
  async claimClose(instanceId: string, kind: CloseKind, now: Date): Promise<boolean> {
    const result = await this.prisma.activityInstance.updateMany({
      where: { id: instanceId, closedAt: null, ...(kind === 'EXPIRED' ? { closesAt: { lte: now } } : {}) },
      data: { closedAt: now, closeKind: kind, closesAt: now },
    });
    if (result.count === 0) return false;
    // Clamp every still-open attempt's own deadline to the same instant,
    // so AttemptsService's answer/draft guards (which check the ATTEMPT's
    // own closesAt, not the instance's) reject anything that arrives after
    // this point too.
    await this.prisma.attempt.updateMany({ where: { activityInstanceId: instanceId, status: 'IN_PROGRESS' }, data: { closesAt: now } });
    return true;
  }

  /** Claims every still-open timed instance in a session (SessionsService.end). */
  async claimCloseForSession(sessionId: string, kind: CloseKind, now: Date): Promise<string[]> {
    const instances = await this.prisma.activityInstance.findMany({
      where: { group: { sessionId }, exerciseId: { not: null }, closedAt: null },
      select: { id: true },
    });
    const claimed: string[] = [];
    for (const instance of instances) {
      if (await this.claimClose(instance.id, kind, now)) claimed.push(instance.id);
    }
    return claimed;
  }

  /** SessionsService.pause() — extending/pausing a running absolute clock
   * makes no sense (§4.6 doesn't describe a pause behaviour for a timed
   * test), so pause is refused outright while one is open. */
  async hasOpenTimedTest(sessionId: string): Promise<boolean> {
    const count = await this.prisma.activityInstance.count({
      where: { group: { sessionId }, exerciseId: { not: null }, closesAt: { not: null }, closedAt: null },
    });
    return count > 0;
  }
}
