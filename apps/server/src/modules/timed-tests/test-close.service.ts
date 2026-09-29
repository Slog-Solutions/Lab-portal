import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { AttemptStatus, resolveTestPolicy, type VocabularyTestConfig } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptsService } from '../attempts/attempts.service';
import { SessionsService } from '../sessions/sessions.service';
import { ControlGateway } from '../control/control.gateway';
import { TestClockService, type CloseKind } from './test-clock.service';

const SWEEP_INTERVAL_MS = 5_000;
const MAX_INDIVIDUAL_PER_SWEEP = 200;

/**
 * SPEC-mcq-test-timed-reveal.md §4.5/§6.2 — the close scheduler. A single
 * service owning every pending close, cohort and individual alike.
 *
 * Durability contract this class exists to satisfy:
 *  - `closesAt`/`closedAt`/`finalizedAt` are persisted columns, not
 *    in-memory timers — a server restart loses no state.
 *  - A 5s sweep (never a bare setTimeout) catches anything due, including
 *    whatever became due while the server was down.
 *  - Closing is idempotent: `finalizeInstance` is deduplicated in-process
 *    (the `inflight` map) AND safe against a second, fully independent
 *    call (another node, a retried sweep tick) because every DB write in
 *    the sequence is itself a conditional `updateMany` that only the
 *    first caller to match wins (TestClockService.claimClose, and the
 *    `finalizedAt: null` gate on the side-effects step below).
 */
@Injectable()
export class TestCloseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TestCloseService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AttemptsService,
    private readonly sessions: SessionsService,
    private readonly gateway: ControlGateway,
    private readonly testClock: TestClockService,
  ) {}

  /** Startup reconciliation (§4.5): one sweep before the interval starts,
   * so anything that closed while the server was down runs immediately
   * rather than waiting up to 5s. Not awaited — main.ts's `listen()` must
   * not block on this, and every step below is itself crash-safe. */
  onApplicationBootstrap(): void {
    void this.sweep().catch((err) => this.logger.error('Startup sweep failed', err as Error));
    this.timer = setInterval(() => void this.sweep().catch((err) => this.logger.error('Sweep failed', err as Error)), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Exposed (not just the interval) so a lazy caller — AttemptsService.getResult
   * on an individual attempt whose sweep hasn't run yet, or a teacher
   * override that wants the effect to be visible immediately — can kick
   * one cycle without waiting for the timer. Re-entrancy guarded: a slow
   * sweep (many stations, DB latency) must not overlap the next tick. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = new Date();

      // Cohort: closed-but-not-finalized (crash recovery — the claim
      // landed but the process died before the side effects ran) OR an
      // absolute deadline that has passed but was never claimed at all.
      const instances = await this.prisma.activityInstance.findMany({
        where: { exerciseId: { not: null }, finalizedAt: null, OR: [{ closedAt: { not: null } }, { closesAt: { lte: now } }] },
        select: { id: true },
      });
      await Promise.all(instances.map((i) => this.finalizeInstance(i.id, 'EXPIRED')));

      // Individual (assignment/self-study): no instance to claim through —
      // AttemptsService.finalizeVocabAttempt's own conditional updateMany
      // IS the atomic guard, so these are auto-submitted one at a time
      // with no separate claim step.
      const overdue = await this.prisma.attempt.findMany({
        where: { activityInstanceId: null, status: AttemptStatus.IN_PROGRESS, closesAt: { lte: now } },
        select: { id: true },
        take: MAX_INDIVIDUAL_PER_SWEEP,
      });
      for (const attempt of overdue) {
        await this.attempts.autoSubmitExpired(attempt.id).catch((err) => this.logger.error(`Auto-submit failed for attempt ${attempt.id}`, err as Error));
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** Runs the full close sequence for one instance: claim -> auto-submit
   * every still-open attempt -> grade (already done per-attempt by
   * finalizeVocabAttempt) -> reveal (unless no-reveal/teacher-release) ->
   * push + notify. Deduplicated per-instance in-process; safe to call
   * concurrently or repeatedly from anywhere (sweep, Reveal now, Close,
   * session end, a lazy fetch) — see the class doc comment. */
  async finalizeInstance(instanceId: string, kind: CloseKind): Promise<void> {
    const existing = this.inflight.get(instanceId);
    if (existing) return existing;
    const promise = this.doFinalize(instanceId, kind).finally(() => this.inflight.delete(instanceId));
    this.inflight.set(instanceId, promise);
    return promise;
  }

  /** ON_TEACHER_RELEASE's own manual step, and also how a "Close without
   * reveal" gets un-done later — reveals whatever is already SCORED
   * without needing to re-run the close claim (a no-op if it's already
   * closed; harmless if it isn't — releasing early only affects attempts
   * that have already submitted). Goes through the same REVEAL_NOW kind
   * as the teacher's own "Reveal now" button — see doFinalize's own doc
   * comment on why that kind always reveals regardless of the test's
   * configured revealMode (this method's entire purpose is releasing an
   * ON_TEACHER_RELEASE test, so it can't be excluded by that same policy
   * check). Idempotent: a second call sees every SCORED attempt already
   * has a revealAt and does nothing further. */
  async release(instanceId: string): Promise<void> {
    await this.finalizeInstance(instanceId, 'REVEAL_NOW');
  }

  private async doFinalize(instanceId: string, kind: CloseKind): Promise<void> {
    const now = new Date();
    // Idempotent regardless of current state — a no-op if this instance
    // was already closed by an earlier caller (a different kind, even).
    await this.testClock.claimClose(instanceId, kind, now);

    const instance = await this.prisma.activityInstance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        groupId: true,
        closeKind: true,
        finalizedAt: true,
        exercise: { select: { config: true } },
        group: { select: { sessionId: true } },
      },
    });
    if (!instance || !instance.exercise || instance.finalizedAt) return; // already fully finalized, or not a real timed test

    // Auto-submit every attempt still IN_PROGRESS — whatever was answered
    // counts, unanswered scores zero (§4.1).
    const openAttempts = await this.prisma.attempt.findMany({
      where: { activityInstanceId: instanceId, status: AttemptStatus.IN_PROGRESS },
      select: { id: true },
    });
    for (const a of openAttempts) {
      await this.attempts.autoSubmitExpired(a.id).catch((err) => this.logger.error(`Auto-submit failed for attempt ${a.id}`, err as Error));
    }

    // Reveal — unless this was an explicit no-reveal close/session-end, or
    // (EXPIRED only) the test's own policy says the natural clock running
    // out must NOT auto-reveal an ON_TEACHER_RELEASE test (§4.3 "Never
    // automatic"). REVEAL_NOW always reveals regardless of policy — it is
    // an explicit teacher override (§4.4), and it is also the ONLY kind
    // `release()` uses (see its own doc comment): a teacher calling
    // Release on an ON_TEACHER_RELEASE test must actually release it, so
    // this can't ALSO be the thing that excludes that mode.
    const policy = resolveTestPolicy(instance.exercise.config as VocabularyTestConfig);
    const closeKind = instance.closeKind ?? kind;
    const shouldReveal = closeKind === 'REVEAL_NOW' || (closeKind === 'EXPIRED' && policy.revealMode !== 'ON_TEACHER_RELEASE');
    let revealed = false;
    if (shouldReveal) {
      // `revealAt: null` alone is NOT enough of a guard here — an
      // ON_TIME_EXPIRY attempt's revealAt is set to its own (future)
      // closesAt the moment it's scored (finalizeVocabAttempt), not left
      // null, so an early "Reveal now" needs to pull that future value
      // back to `now` too, or an already-submitted student's own stale
      // revealAt would just sit unrevealed until it silently caught up on
      // its own. Fires regardless of how many rows actually changed on
      // THIS call (e.g. a re-run after everyone's already revealed) — the
      // instance-level revealedAt/event is still correct to (re)assert.
      await this.prisma.attempt.updateMany({
        where: { activityInstanceId: instanceId, status: AttemptStatus.SCORED, OR: [{ revealAt: null }, { revealAt: { gt: now } }] },
        data: { revealAt: now },
      });
      await this.prisma.activityInstance.updateMany({ where: { id: instanceId, revealedAt: null }, data: { revealedAt: now } });
      revealed = true;
    } else {
      // §4.4 "Close without reveal" / a session ending must actually
      // PREVENT reveal, not just skip it this instant — an attempt
      // submitted earlier under ON_TIME_EXPIRY already carries its own
      // future closesAt as revealAt, which would otherwise arrive on its
      // own and reveal the key regardless of this override. Pull it back
      // to null — "awaiting teacher release" — the same state
      // ON_TEACHER_RELEASE attempts already sit in, so a later explicit
      // Release (TestCloseService.release) still works normally.
      await this.prisma.attempt.updateMany({
        where: { activityInstanceId: instanceId, status: AttemptStatus.SCORED, revealAt: { not: null } },
        data: { revealAt: null },
      });
    }

    // Only the caller that wins THIS conditional update runs the pushes —
    // every other concurrent/duplicate caller (another sweep tick that
    // started before this one finished, a teacher click racing the sweep)
    // stops here having already been a no-op past the steps above.
    const claimed = await this.prisma.activityInstance.updateMany({ where: { id: instanceId, finalizedAt: null }, data: { finalizedAt: now } });
    if (claimed.count === 0) return;

    await this.sessions.republish(instance.group.sessionId);
    if (revealed) this.gateway.emitToGroup(instance.groupId, 'test:revealed', { activityInstanceId: instanceId });
  }
}
