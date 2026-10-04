import { Injectable } from '@nestjs/common';
import type { TranslationLangStatus } from '@lab/shared';

export interface ClassTranslationState {
  /** Per-target-language stream state, keyed by language code. */
  langs: Map<string, TranslationLangStatus>;
  /** False while the translator is unreachable or refusing work. */
  engineOk: boolean;
  /** Operator-facing reason the engine is not OK. */
  detail?: string;
  updatedAt: number;
}

/**
 * In-memory, per-class state of the live translation streams.
 *
 * Exists in ControlModule — not TranslationModule — for exactly the
 * reason RoundTableFloorStore does: SessionStateService must read it to
 * build a station snapshot, and TranslationService must write it, so
 * putting it next to the writer would make ControlModule and
 * TranslationModule import each other. A plain store both can depend on
 * breaks that cycle without either knowing about the other.
 *
 * Deliberately NOT persisted. It describes what is running right now on
 * a GPU; after a server restart nothing is, and the reconciler's first
 * sweep rebuilds it from the database within seconds.
 */
@Injectable()
export class TranslationStateStore {
  private readonly byClass = new Map<string, ClassTranslationState>();

  get(classId: string): ClassTranslationState | null {
    return this.byClass.get(classId) ?? null;
  }

  /** Replaces one class's stream state wholesale — the reconciler always
   * knows the complete desired set, so a merge would only let a
   * no-longer-wanted language linger in a teacher's status display. */
  set(classId: string, state: Omit<ClassTranslationState, 'updatedAt'>): void {
    this.byClass.set(classId, { ...state, updatedAt: Date.now() });
  }

  clear(classId: string): void {
    this.byClass.delete(classId);
  }

  classIds(): string[] {
    return [...this.byClass.keys()];
  }

  /**
   * What one seat should be told about translation, given the language it
   * selected. Resolves to the four `status` values
   * TranslationStationState documents:
   * - the student picked the spoken language -> 'ready' (original audio)
   * - a live stream exists for their language -> 'ready'
   * - a stream exists but is still spinning up -> 'starting'
   * - a caption-only language, or the engine is down -> the honest reason
   *
   * `speechCapable` is passed in rather than looked up here so this store
   * stays free of the language catalog.
   */
  statusFor(
    classId: string,
    selectedLang: string,
    spokenLang: string,
    speechCapable: boolean,
  ): { status: 'ready' | 'starting' | 'captions-only' | 'unavailable'; detail?: string } {
    if (selectedLang === spokenLang) return { status: 'ready' };
    const state = this.byClass.get(classId);
    if (!state) return { status: 'starting' };
    if (!state.engineOk) return { status: 'unavailable', detail: state.detail ?? 'The translation service is unavailable' };
    const lang = state.langs.get(selectedLang);
    if (!lang) {
      return { status: 'unavailable', detail: 'No translation stream is running for this language yet' };
    }
    if (lang.state === 'error') return { status: 'unavailable', detail: lang.error ?? 'The translation stream failed' };
    if (lang.state === 'starting') return { status: 'starting' };
    // 'live' or 'degraded'. A caption-only language is working as
    // designed, so it is not an error — the student keeps the teacher's
    // own audio and reads along.
    if (!speechCapable) return { status: 'captions-only' };
    return { status: 'ready' };
  }
}
