import { Injectable, Logger, NotFoundException, OnModuleDestroy, type OnApplicationBootstrap } from '@nestjs/common';
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  findTranslationLanguage,
  type TranslationEngineHealth,
  type TranslationLangStatus,
} from '@lab/shared';
import { classBroadcastRoom } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { ControlGateway } from '../control/control.gateway';
import { SessionStateService } from '../control/session-state.service';
import { TranslationStateStore } from '../control/translation-state.store';
import { MediaService } from '../media/media.service';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslatorClient } from './translator.client';

/** Debounce on reconcile triggers — a batch-scoped class start attaches
 * 40 stations in a loop, each of which would otherwise fire its own
 * reconcile and its own translator call. */
const RECONCILE_DEBOUNCE_MS = 300;

/** Periodic sweep. Heals a translator restart (its sessions are gone but
 * ours are not) without anything having to notice the restart. */
const SWEEP_INTERVAL_MS = 10_000;

/** How long a language with no listeners is kept alive. A student
 * flipping through the dropdown, or walking between seats, must not tear
 * down and restart a GPU stream several times — the model's startup cost
 * is paid in the first seconds of lag for everyone else on it. */
const LANGUAGE_GRACE_MS = 30_000;

/** Status push cadence while any class has translation on. */
const STATUS_INTERVAL_MS = 2_000;

interface PendingDrop {
  classId: string;
  lang: string;
  at: number;
}

/**
 * Owns which (class, language) translation streams SHOULD exist, and
 * converges the translator onto that set.
 *
 * Reconciler, not a command handler, for the same reason
 * DesiredStationState is declarative (design doc §4.3): the triggers are
 * many and racy — class start/end, a teacher's toggle, 40 students
 * picking languages, seat sign-in/out, a translator restart — and any
 * imperative start/stop pairing across those would eventually leak a
 * stream or kill a live one. Here every trigger just marks the class
 * dirty and one code path computes the whole answer.
 *
 * Demand for a class = the distinct listening languages of the students
 * currently seated in it, minus the language the teacher is speaking
 * (those students hear the teacher directly), intersected with the
 * admin-enabled list, capped by maxStreams. One stream serves every
 * student on that language, so 40 students across 3 languages is 3
 * streams.
 */
@Injectable()
export class TranslationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TranslationService.name);
  private readonly dirty = new Set<string>();
  private debounce: NodeJS.Timeout | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  /** Languages whose last listener left, held for LANGUAGE_GRACE_MS. */
  private readonly pendingDrops = new Map<string, PendingDrop>();
  /** Guards against two reconciles for the same class overlapping — the
   * translator's upsert is idempotent, but two in flight can land out of
   * order and leave it with the older language set. */
  private readonly inFlight = new Set<string>();
  private lastHealth: TranslationEngineHealth = { reachable: false, gpu: false };

  constructor(
    private readonly prisma: PrismaService,
    private readonly translator: TranslatorClient,
    private readonly settings: TranslationSettingsService,
    private readonly media: MediaService,
    private readonly store: TranslationStateStore,
    private readonly gateway: ControlGateway,
    private readonly sessionState: SessionStateService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.translator.configured) return;
    // A server restart leaves the translator holding sessions for classes
    // that may have ended meanwhile; the first sweep reconciles both
    // directions, including deleting orphans.
    this.sweep = setInterval(() => void this.sweepAll(), SWEEP_INTERVAL_MS);
    this.statusTimer = setInterval(() => void this.pushStatuses(), STATUS_INTERVAL_MS);
    setTimeout(() => void this.sweepAll(), 1_000);
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  get configured(): boolean {
    return this.translator.configured;
  }

  // ---- Triggers -----------------------------------------------------------

  /** Marks a class as needing reconciliation. Safe to call from any
   * number of places on any number of events; cheap when nothing changed
   * (the translator upsert is skipped when the language set matches). */
  markDirty(classId: string | null | undefined): void {
    if (!classId || !this.translator.configured) return;
    this.dirty.add(classId);
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const ids = [...this.dirty];
      this.dirty.clear();
      for (const id of ids) void this.reconcileClass(id);
    }, RECONCILE_DEBOUNCE_MS);
  }

  /** The class a station is currently in, for callers that only have a
   * station id (sign-in, seat moves). */
  async markDirtyForStation(stationId: string): Promise<void> {
    if (!this.translator.configured) return;
    const station = await this.prisma.station.findUnique({ where: { id: stationId }, select: { liveClassId: true } });
    this.markDirty(station?.liveClassId);
  }

  /** A teacher's currently active class. Used where the station's own
   * link to the class is already gone (ClassroomService.releaseAndNotify
   * runs after release() has cleared liveClassId) and the departing
   * student's former teacher is the only remaining handle on it. */
  async markDirtyForTeacher(teacherId: string): Promise<void> {
    if (!this.translator.configured) return;
    const liveClass = await this.prisma.liveClass.findFirst({
      where: { teacherId, state: 'ACTIVE' },
      select: { id: true },
    });
    this.markDirty(liveClass?.id);
  }

  /** Teardown on class end: drop the translator session immediately
   * rather than waiting for the sweep, so the GPU is free for the next
   * class the moment this one ends. */
  async teardownClass(classId: string): Promise<void> {
    if (!this.translator.configured) return;
    this.dirty.delete(classId);
    for (const key of [...this.pendingDrops.keys()]) {
      if (this.pendingDrops.get(key)?.classId === classId) this.pendingDrops.delete(key);
    }
    this.store.clear(classId);
    await this.translator.deleteSession(classId);
  }

  // ---- Teacher-facing operations ------------------------------------------

  /** The per-class toggle. Returns the stored state so the caller can
   * render it without a second read. */
  async setClassTranslation(
    classId: string,
    enabled: boolean,
    spokenLanguage?: string,
  ): Promise<{ enabled: boolean; spokenLanguage: string }> {
    const liveClass = await this.prisma.liveClass.update({
      where: { id: classId },
      data: { translationEnabled: enabled, ...(spokenLanguage ? { spokenLanguage } : {}) },
      select: { id: true, translationEnabled: true, spokenLanguage: true },
    });
    if (!enabled) {
      await this.teardownClass(classId);
    } else {
      this.markDirty(classId);
    }
    // Every seat's snapshot carries the selector and its status, so both
    // directions of the toggle must reach the students, not just the
    // teacher's own console.
    await this.pushSnapshotsForClass(classId);
    return { enabled: liveClass.translationEnabled, spokenLanguage: liveClass.spokenLanguage };
  }

  /** A seat picking its listening language. Persisted on the USER so it
   * follows the student to another seat or another day. */
  async setListenLanguage(stationId: string, lang: string): Promise<void> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { currentUserId: true, liveClassId: true },
    });
    if (!station?.currentUserId) return; // nobody signed in at this seat
    const settings = await this.settings.get();
    const liveClass = station.liveClassId
      ? await this.prisma.liveClass.findUnique({ where: { id: station.liveClassId }, select: { spokenLanguage: true } })
      : null;
    // The spoken language is always selectable ("no translation"), even if
    // an admin disabled it as a target.
    const allowed = new Set(settings.enabledLanguages);
    if (liveClass) allowed.add(liveClass.spokenLanguage);
    if (!allowed.has(lang)) {
      this.logger.debug(`Rejected listen language '${lang}' for station ${stationId} (not enabled)`);
      return;
    }
    await this.prisma.user.update({ where: { id: station.currentUserId }, data: { listenLanguage: lang } });
    this.markDirty(station.liveClassId);
    // Push this seat's own snapshot now: the student must see their
    // choice take effect immediately, not after the debounce and a
    // translator round-trip.
    const snapshot = await this.sessionState.getDesiredState(stationId);
    this.gateway.pushSnapshot(stationId, snapshot);
  }

  async statusFor(classId: string): Promise<{
    classId: string;
    enabled: boolean;
    spokenLang: string;
    langs: TranslationLangStatus[];
    engine: TranslationEngineHealth;
  }> {
    const liveClass = await this.prisma.liveClass.findUnique({
      where: { id: classId },
      select: { translationEnabled: true, spokenLanguage: true },
    });
    if (!liveClass) throw new NotFoundException('Class not found');
    const state = this.store.get(classId);
    const listeners = await this.listenerCounts(classId);
    const langs = [...(state?.langs.values() ?? [])].map((l) => ({ ...l, listeners: listeners.get(l.code) ?? 0 }));
    return {
      classId,
      enabled: liveClass.translationEnabled,
      spokenLang: liveClass.spokenLanguage,
      langs,
      engine: this.lastHealth,
    };
  }

  engineHealth(): TranslationEngineHealth {
    return this.lastHealth;
  }

  // ---- Reconciliation -----------------------------------------------------

  private async sweepAll(): Promise<void> {
    this.lastHealth = await this.translator.health();
    const active = await this.prisma.liveClass.findMany({
      where: { state: 'ACTIVE', translationEnabled: true },
      select: { id: true },
    });
    const wanted = new Set(active.map((c) => c.id));
    for (const id of wanted) await this.reconcileClass(id);
    // Anything the translator still holds for a class that has ended (or
    // had translation switched off) while this server was down.
    try {
      for (const session of await this.translator.sessions()) {
        if (!wanted.has(session.sessionId) && !session.sessionId.startsWith('trtest:')) {
          this.logger.log(`Dropping orphaned translator session ${session.sessionId}`);
          await this.translator.deleteSession(session.sessionId);
        }
      }
    } catch (err) {
      this.logger.debug(`Could not list translator sessions: ${(err as Error).message}`);
    }
    for (const classId of this.store.classIds()) {
      if (!wanted.has(classId)) this.store.clear(classId);
    }
  }

  private async reconcileClass(classId: string): Promise<void> {
    if (!this.translator.configured || this.inFlight.has(classId)) {
      // A reconcile is already running for this class, so the newer
      // demand goes back through markDirty rather than straight into
      // `dirty`: adding to the set alone would NOT re-arm the debounce
      // timer (the callback clears it before running us), leaving the
      // change to be picked up only by the 10s sweep. Caught live —
      // a student's language choice took ten seconds to take effect
      // whenever it landed on top of another reconcile, which is
      // exactly what the teacher's own toggle does a moment earlier.
      if (this.inFlight.has(classId)) this.markDirty(classId);
      return;
    }
    this.inFlight.add(classId);
    try {
      const liveClass = await this.prisma.liveClass.findUnique({
        where: { id: classId },
        select: { id: true, state: true, translationEnabled: true, spokenLanguage: true, teacherId: true },
      });
      if (!liveClass || liveClass.state !== 'ACTIVE' || !liveClass.translationEnabled) {
        await this.teardownClass(classId);
        return;
      }

      const desired = await this.desiredLanguages(classId, liveClass.spokenLanguage);
      if (desired.length === 0) {
        // Nothing to translate — everyone is listening in the spoken
        // language. Free the GPU rather than idling a stream on it.
        this.store.set(classId, { langs: new Map(), engineOk: this.lastHealth.reachable, detail: undefined });
        await this.translator.deleteSession(classId);
        return;
      }

      const settings = await this.settings.get();
      const room = classBroadcastRoom(classId);
      // Re-ensure for the same reason SessionStateService does: a single
      // unretried createRoom at class start can lose to a network blip,
      // and the translator joining a non-existent room just fails.
      await this.media.ensureRoom(room);
      const token = await this.media.mintServiceToken({ scopeId: classId, room });

      const stat = await this.translator.upsertSession({
        sessionId: classId,
        room,
        livekitUrl: this.translator.livekitUrl,
        token,
        // The teacher's own LiveKit identity is `st:teacher:<sub>` (see
        // MediaService.mintToken + MediaController.broadcastToken). A
        // prefix, not a sid: the teacher re-publishes on every mic
        // toggle, so any sid we captured would be stale within seconds.
        sourceIdentityPrefix: 'st:teacher:',
        sourceLanguage: liveClass.spokenLanguage,
        targetLanguages: desired,
        engineParams: settings.engineParams,
      });

      const listeners = await this.listenerCounts(classId);
      const langs = new Map<string, TranslationLangStatus>();
      for (const s of stat.streams) {
        langs.set(s.lang, {
          code: s.lang,
          listeners: listeners.get(s.lang) ?? 0,
          lagMs: s.lagMs,
          state: s.state,
          ...(s.error ? { error: s.error } : {}),
        });
      }
      this.store.set(classId, { langs, engineOk: true, detail: undefined });
      await this.pushSnapshotsForClass(classId);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`reconcileClass(${classId}) failed: ${message}`);
      // Record the failure so students get an honest banner and keep the
      // teacher's original audio, rather than silence or a spinner.
      this.store.set(classId, { langs: new Map(), engineOk: false, detail: message });
      await this.pushSnapshotsForClass(classId);
    } finally {
      this.inFlight.delete(classId);
    }
  }

  /**
   * The languages a class's streams should cover: what seated students
   * actually selected, minus the spoken language, intersected with the
   * admin-enabled list, plus anything inside its grace window, capped at
   * maxStreams (most listeners win).
   */
  private async desiredLanguages(classId: string, spokenLang: string): Promise<string[]> {
    const settings = await this.settings.get();
    const enabled = new Set(settings.enabledLanguages);
    const counts = await this.listenerCounts(classId);

    const wanted = new Map<string, number>();
    for (const [lang, count] of counts) {
      if (lang === spokenLang || !enabled.has(lang)) continue;
      wanted.set(lang, count);
    }

    // Grace window: a language whose last listener just left stays up
    // briefly, and one that is wanted again clears its pending drop.
    const now = Date.now();
    for (const [key, drop] of [...this.pendingDrops]) {
      if (drop.classId !== classId) continue;
      if (wanted.has(drop.lang)) {
        this.pendingDrops.delete(key);
      } else if (now - drop.at < LANGUAGE_GRACE_MS) {
        wanted.set(drop.lang, 0);
      } else {
        this.pendingDrops.delete(key);
      }
    }
    const previous = this.store.get(classId);
    for (const lang of previous?.langs.keys() ?? []) {
      const key = `${classId}:${lang}`;
      if (!wanted.has(lang) && !this.pendingDrops.has(key)) {
        this.pendingDrops.set(key, { classId, lang, at: now });
        wanted.set(lang, 0);
      }
    }

    const ranked = [...wanted.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
    if (ranked.length > settings.maxStreams) {
      this.logger.warn(
        `Class ${classId} wants ${ranked.length} translation streams but maxStreams is ${settings.maxStreams} — ` +
          `dropping ${ranked.slice(settings.maxStreams).join(', ')}`,
      );
    }
    return ranked.slice(0, settings.maxStreams);
  }

  /** How many seated students currently listen in each language. */
  private async listenerCounts(classId: string): Promise<Map<string, number>> {
    const stations = await this.prisma.station.findMany({
      where: { liveClassId: classId, currentUserId: { not: null } },
      select: { currentUser: { select: { listenLanguage: true } } },
    });
    const counts = new Map<string, number>();
    for (const s of stations) {
      const lang = s.currentUser?.listenLanguage ?? DEFAULT_TRANSLATION_LANGUAGE;
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    return counts;
  }

  private async pushSnapshotsForClass(classId: string): Promise<void> {
    const stations = await this.prisma.station.findMany({ where: { liveClassId: classId }, select: { id: true } });
    for (const station of stations) {
      const snapshot = await this.sessionState.getDesiredState(station.id);
      this.gateway.pushSnapshot(station.id, snapshot);
    }
  }

  /** Per-class status to each owning teacher's dashboard room, so a
   * teacher watches lag and listener counts live instead of hearing
   * about a problem from a student. */
  private async pushStatuses(): Promise<void> {
    const active = await this.prisma.liveClass.findMany({
      where: { state: 'ACTIVE', translationEnabled: true },
      select: { id: true, teacherId: true, spokenLanguage: true },
    });
    if (active.length === 0) return;
    let sessions: Awaited<ReturnType<TranslatorClient['sessions']>> = [];
    try {
      sessions = await this.translator.sessions();
    } catch {
      // Health is refreshed by the sweep; a failed poll just means this
      // tick reports the last known stream state.
    }
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    for (const liveClass of active) {
      const listeners = await this.listenerCounts(liveClass.id);
      const live = byId.get(liveClass.id);
      const previous = this.store.get(liveClass.id);
      const langs = new Map<string, TranslationLangStatus>();
      if (live) {
        for (const s of live.streams) {
          langs.set(s.lang, {
            code: s.lang,
            listeners: listeners.get(s.lang) ?? 0,
            lagMs: s.lagMs,
            state: s.state,
            ...(s.error ? { error: s.error } : {}),
          });
        }
        this.store.set(liveClass.id, { langs, engineOk: true, detail: undefined });
      } else if (previous) {
        for (const [code, l] of previous.langs) langs.set(code, { ...l, listeners: listeners.get(code) ?? 0 });
      }
      this.gateway.emitTranslationStatus(liveClass.teacherId, {
        classId: liveClass.id,
        enabled: true,
        spokenLang: liveClass.spokenLanguage,
        langs: [...langs.values()],
        engine: this.lastHealth,
      });
    }
  }

  /** Whether a language can be SYNTHESISED, for the station snapshot's
   * captions-only distinction. Unknown codes are treated as text-only —
   * the safe direction, since a wrong `true` would mute the teacher's
   * audio and leave the student with nothing. */
  static speechCapable(lang: string): boolean {
    return findTranslationLanguage(lang)?.speech ?? false;
  }
}
