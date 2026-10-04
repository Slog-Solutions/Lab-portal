/**
 * Language catalog for live class translation (SeamlessStreaming).
 *
 * Codes are ISO-639-3, which is what the Seamless models themselves take
 * as `tgt_lang` — deliberately NOT the 2-letter codes used elsewhere in
 * the UI, so a code can be passed straight through to the engine with no
 * mapping table that could drift.
 *
 * `speech: true` means the model can SYNTHESISE this language (S2ST).
 * Seamless supports ~96 target languages for text but only 36 for
 * speech; a `speech: false` language is caption-only — the student keeps
 * hearing the teacher's original audio and reads the translation. The
 * flag is verified against the loaded checkpoint at service start
 * (see services/translator `/health`'s `langMismatch`), so a wrong value
 * here surfaces as a warning rather than a runtime failure mid-class.
 */

export interface TranslationLanguage {
  /** ISO-639-3 code, passed verbatim to the model as tgt_lang. */
  code: string;
  /** English name, for the teacher/admin console. */
  name: string;
  /** Endonym, shown to the student — they are picking their OWN language
   * and may not read English well enough to find it in an English list. */
  nativeName: string;
  /** Whether translated SPEECH is available (otherwise captions only). */
  speech: boolean;
}

/** The language a class is assumed to be taught in unless set otherwise. */
export const DEFAULT_TRANSLATION_LANGUAGE = 'eng';

/**
 * Curated catalog: the Indian languages this lab actually serves, plus the
 * major world languages, rather than all 96 Seamless targets — an admin
 * picking from a 96-row list is worse UX, and every extra enabled
 * language is a potential GPU stream. Add rows here as needed; anything
 * in this list that the engine rejects is reported at startup.
 */
export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  // --- Indian languages (speech where Seamless supports S2ST) ---
  { code: 'eng', name: 'English', nativeName: 'English', speech: true },
  { code: 'hin', name: 'Hindi', nativeName: 'हिन्दी', speech: true },
  { code: 'ben', name: 'Bengali', nativeName: 'বাংলা', speech: true },
  { code: 'tel', name: 'Telugu', nativeName: 'తెలుగు', speech: true },
  { code: 'urd', name: 'Urdu', nativeName: 'اردو', speech: true },
  // Caption-only: Seamless translates INTO these as text but cannot
  // synthesise them (not among the 36 S2ST targets).
  { code: 'tam', name: 'Tamil', nativeName: 'தமிழ்', speech: false },
  { code: 'mar', name: 'Marathi', nativeName: 'मराठी', speech: false },
  { code: 'guj', name: 'Gujarati', nativeName: 'ગુજરાતી', speech: false },
  { code: 'kan', name: 'Kannada', nativeName: 'ಕನ್ನಡ', speech: false },
  { code: 'mal', name: 'Malayalam', nativeName: 'മലയാളം', speech: false },
  { code: 'pan', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', speech: false },
  { code: 'ory', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', speech: false },
  { code: 'asm', name: 'Assamese', nativeName: 'অসমীয়া', speech: false },
  { code: 'npi', name: 'Nepali', nativeName: 'नेपाली', speech: false },
  // --- Major world languages (all S2ST-capable) ---
  { code: 'arb', name: 'Arabic', nativeName: 'العربية', speech: true },
  { code: 'cmn', name: 'Chinese (Mandarin)', nativeName: '中文', speech: true },
  { code: 'fra', name: 'French', nativeName: 'Français', speech: true },
  { code: 'deu', name: 'German', nativeName: 'Deutsch', speech: true },
  { code: 'spa', name: 'Spanish', nativeName: 'Español', speech: true },
  { code: 'por', name: 'Portuguese', nativeName: 'Português', speech: true },
  { code: 'rus', name: 'Russian', nativeName: 'Русский', speech: true },
  { code: 'jpn', name: 'Japanese', nativeName: '日本語', speech: true },
  { code: 'kor', name: 'Korean', nativeName: '한국어', speech: true },
  { code: 'ita', name: 'Italian', nativeName: 'Italiano', speech: true },
  { code: 'nld', name: 'Dutch', nativeName: 'Nederlands', speech: true },
  { code: 'tur', name: 'Turkish', nativeName: 'Türkçe', speech: true },
  { code: 'vie', name: 'Vietnamese', nativeName: 'Tiếng Việt', speech: true },
  { code: 'tha', name: 'Thai', nativeName: 'ไทย', speech: true },
  { code: 'ind', name: 'Indonesian', nativeName: 'Bahasa Indonesia', speech: true },
  { code: 'pes', name: 'Persian', nativeName: 'فارسی', speech: true },
];

const BY_CODE = new Map(TRANSLATION_LANGUAGES.map((l) => [l.code, l]));

export function findTranslationLanguage(code: string): TranslationLanguage | undefined {
  return BY_CODE.get(code);
}

export function isKnownTranslationLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

/** Display label for a language code — falls back to the raw code so an
 * unknown value (e.g. one an admin set before a catalog change) still
 * renders as something, never "undefined". */
export function translationLanguageLabel(code: string): string {
  const lang = BY_CODE.get(code);
  return lang ? lang.name : code;
}

/**
 * The languages offered out of the box. Small on purpose: every enabled
 * language a student can pick is a GPU stream the server may have to
 * start mid-class, so widening this is an explicit admin decision.
 */
export const DEFAULT_ENABLED_TRANSLATION_LANGUAGES: readonly string[] = ['eng', 'hin', 'ben', 'tel', 'urd', 'tam'];

/** Engine tuning knobs, surfaced in the admin UI and sent to the
 * translator with each session. Defaults are the Seamless demo's, which
 * trade a little quality for the lower latency a classroom needs. */
export interface TranslationEngineParams {
  /** How much new audio the model consumes per step, ms. Lower = lower
   * latency, more GPU work per second of speech. */
  sourceSegmentSizeMs: number;
  /** Confidence needed before the model commits to emitting a token.
   * Lower = faster but more re-phrasing; higher = cleaner but laggier. */
  decisionThreshold: number;
  /** Audio the model hears before it will emit anything at all, ms. */
  minStartingWaitMs: number;
  /** Backlog at which translated-speech playout starts speeding up. */
  catchUpStartMs: number;
  /** Maximum playout speed-up (1.15 = 15% faster, pitch preserved). */
  maxCatchUpRate: number;
  /** Backlog at which playout gives up and skips to the next segment. */
  dropBacklogMs: number;
}

export const DEFAULT_TRANSLATION_ENGINE_PARAMS: TranslationEngineParams = {
  sourceSegmentSizeMs: 320,
  decisionThreshold: 0.5,
  minStartingWaitMs: 576,
  catchUpStartMs: 1500,
  maxCatchUpRate: 1.15,
  dropBacklogMs: 5000,
};

/** Admin-owned settings, stored as AppSetting['translation']. */
export interface TranslationSettings {
  enabledLanguages: string[];
  engineParams: TranslationEngineParams;
  /** Hard ceiling on concurrent GPU streams, across all classes. */
  maxStreams: number;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  enabledLanguages: [...DEFAULT_ENABLED_TRANSLATION_LANGUAGES],
  engineParams: { ...DEFAULT_TRANSLATION_ENGINE_PARAMS },
  maxStreams: 4,
};

/** Per-language state as reported to a teacher's console. */
export type TranslationStreamState = 'starting' | 'live' | 'degraded' | 'error';

export interface TranslationLangStatus {
  code: string;
  /** How many seats are currently listening in this language. */
  listeners: number;
  /** Observed end-to-end lag of translated speech, ms (null until known). */
  lagMs: number | null;
  state: TranslationStreamState;
  error?: string;
}

export interface TranslationEngineHealth {
  reachable: boolean;
  /** False when the service is up but running without CUDA. */
  gpu: boolean;
  device?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  activeStreams?: number;
  maxStreams?: number;
  modelLoaded?: boolean;
  /** Set when the service is up but cannot translate (e.g. the model did
   * not fit in VRAM) — shown verbatim to the teacher/admin. */
  detail?: string;
}

/** One caption update, sent over the LiveKit data channel. */
export interface TranslationCaption {
  lang: string;
  /** Monotonic within a session — a later delta for the same segId
   * REPLACES the earlier text (the model only ever appends), so a client
   * keyed by segId never flickers or duplicates. */
  segId: number;
  text: string;
  /** The model will not revise this segment again. */
  final: boolean;
  /** Lag of this caption behind the teacher's speech, ms. */
  lagMs: number;
}
