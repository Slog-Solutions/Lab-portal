import { useEffect, useMemo, useRef, useState } from 'react';
import { Captions, CaptionsOff, Languages, Loader2, TriangleAlert } from 'lucide-react';
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  findTranslationLanguage,
  type TranslationCaption,
  type TranslationStationState,
} from '@lab/shared';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';

/** Captions kept on screen. Two finished lines plus the one still being
 * revised is what fits a glanceable strip without becoming a transcript
 * the student reads instead of watching the teacher. */
const VISIBLE_LINES = 3;

/** A caption segment that is still being revised is dropped if the model
 * goes quiet — otherwise a half-finished sentence sits on screen for the
 * rest of the lecture after the teacher stops talking. */
const STALE_SEGMENT_MS = 8_000;

export interface TranslationBarProps {
  translation: TranslationStationState;
  /** Latest caption deltas for the selected language, newest last. */
  captions: TranslationCaption[];
  onSelectLanguage: (lang: string) => void;
  /** Disabled while the station socket is down — the choice could not be
   * sent, and silently keeping the old language is less confusing than a
   * selector that springs back. */
  disabled?: boolean;
}

/**
 * The student's "Listen in ..." control plus the live caption strip.
 *
 * Renders purely from the server's snapshot (`translation`) rather than
 * local state, so a reconnect, a seat move or a teacher switching
 * translation off all converge without any recovery logic here — the same
 * reason DesiredStationState is declarative. The one piece of local state
 * is `showCaptions`, a per-viewer display preference the server has no
 * reason to know about.
 */
export function TranslationBar({ translation, captions, onSelectLanguage, disabled }: TranslationBarProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const { selectedLang, spokenLang, languages, status, detail, enabled } = translation;
  const listeningToOriginal = selectedLang === spokenLang;

  const options = useMemo(
    () =>
      languages.map((code) => {
        const lang = findTranslationLanguage(code);
        return {
          code,
          // Endonym first: a student picking their own language scans for
          // "हिन्दी", not "Hindi".
          label: lang ? (lang.nativeName === lang.name ? lang.name : `${lang.nativeName} · ${lang.name}`) : code,
          speech: lang?.speech ?? false,
          isSpoken: code === spokenLang,
        };
      }),
    [languages, spokenLang],
  );

  const lines = useVisibleCaptions(captions, selectedLang);

  return (
    <div className="w-full max-w-2xl rounded-control border border-hairline bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <label className="text-sm font-medium" htmlFor="translation-language">
          Listen in
        </label>
        <NativeSelect
          id="translation-language"
          compact
          className="w-56"
          value={selectedLang}
          disabled={disabled}
          onChange={(e) => onSelectLanguage(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
              {o.isSpoken ? ' (no translation)' : o.speech ? '' : ' — captions only'}
            </option>
          ))}
        </NativeSelect>

        {!listeningToOriginal && (
          <>
            <StatusChip status={status} detail={detail} enabled={enabled} />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setShowCaptions((v) => !v)}
              aria-pressed={showCaptions}
            >
              {showCaptions ? <Captions className="mr-1.5 h-4 w-4" /> : <CaptionsOff className="mr-1.5 h-4 w-4" />}
              {showCaptions ? 'Hide captions' : 'Show captions'}
            </Button>
          </>
        )}
      </div>

      {!listeningToOriginal && showCaptions && (
        <div
          className="mt-3 min-h-[4.5rem] rounded-control bg-brand-soft px-3 py-2 text-sm leading-relaxed"
          // Announced politely so a screen reader doesn't interrupt the
          // teacher's audio with every revision of a partial segment.
          aria-live="polite"
          aria-atomic="false"
        >
          {lines.length === 0 ? (
            <span className="text-muted-foreground">
              {status === 'ready' || status === 'captions-only'
                ? 'Captions will appear here as the teacher speaks.'
                : 'Waiting for the translation to start…'}
            </span>
          ) : (
            lines.map((line) => (
              <p key={line.segId} className={line.final ? '' : 'text-muted-foreground'}>
                {line.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({
  status,
  detail,
  enabled,
}: {
  status: TranslationStationState['status'];
  detail?: string;
  enabled: boolean;
}) {
  if (status === 'ready') {
    return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium">Translating</span>;
  }
  if (status === 'starting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Starting…
      </span>
    );
  }
  if (status === 'captions-only') {
    return (
      <span
        className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium"
        title="This language has captions but no translated voice — you will keep hearing the teacher."
      >
        Captions only
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      title={detail ?? ''}
    >
      <TriangleAlert className="h-3 w-3" aria-hidden />
      {enabled ? 'Translation unavailable — playing the original' : 'Translation is off'}
    </span>
  );
}

/**
 * Collapses the caption stream into the last few lines for display.
 *
 * Deltas arrive keyed by `segId` and a later delta for the same segment
 * REPLACES the earlier text (the model only appends within a segment), so
 * this keys by segId rather than pushing every delta — without that the
 * strip would show the same sentence growing a word at a time, several
 * times over.
 */
function useVisibleCaptions(captions: TranslationCaption[], selectedLang: string): TranslationCaption[] {
  const [, forceTick] = useState(0);
  const lastAtRef = useRef(0);

  const lines = useMemo(() => {
    const bySeg = new Map<number, TranslationCaption>();
    for (const c of captions) {
      if (c.lang !== selectedLang) continue;
      bySeg.set(c.segId, c);
    }
    return [...bySeg.values()].sort((a, b) => a.segId - b.segId).slice(-VISIBLE_LINES);
  }, [captions, selectedLang]);

  // Drop a trailing non-final segment once the model has clearly stopped
  // revising it, so an abandoned half-sentence does not linger.
  useEffect(() => {
    lastAtRef.current = Date.now();
    const timer = setTimeout(() => forceTick((n) => n + 1), STALE_SEGMENT_MS);
    return () => clearTimeout(timer);
  }, [captions]);

  const last = lines[lines.length - 1];
  if (last && !last.final && Date.now() - lastAtRef.current >= STALE_SEGMENT_MS) {
    return lines.slice(0, -1);
  }
  return lines;
}

/** Whether a student's selection means the teacher's own audio should be
 * silenced locally. Exported so StudentConsole applies exactly this rule
 * to the <audio> elements, with no second interpretation of `status` that
 * could drift from what the bar is telling the student.
 *
 * Only ever true when a translated VOICE is actually playing: a
 * captions-only language, a stream still starting, or an unavailable
 * engine all keep the teacher audible, because the alternative is a
 * student sitting in silence. */
export function shouldMuteOriginal(translation: TranslationStationState | null | undefined): boolean {
  if (!translation || !translation.enabled) return false;
  if (translation.selectedLang === translation.spokenLang) return false;
  if (translation.status !== 'ready') return false;
  return findTranslationLanguage(translation.selectedLang)?.speech ?? false;
}

/** The language this seat wants translated audio for, or null when it
 * should hear the teacher directly. Used by the subscription filter. */
export function wantedTranslationLang(translation: TranslationStationState | null | undefined): string | null {
  if (!translation || !translation.enabled) return null;
  const selected = translation.selectedLang || DEFAULT_TRANSLATION_LANGUAGE;
  return selected === translation.spokenLang ? null : selected;
}
