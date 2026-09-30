import { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Search, X } from 'lucide-react';
import type { DictionaryLookupResult } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fieldClass } from '@/components/ui/input';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { ApiError } from '../../lib/api-client';
import { useDictionaryStore } from '../../stores/dictionary-store';
import { DictionaryAbout } from './DictionaryAbout';

const SUGGEST_DEBOUNCE_MS = 150;

/**
 * The offline dictionary side panel (spec §6.2). Docked, non-modal — see
 * StudentConsole's render, which keeps the live/activity view mounted and
 * visible alongside this, never behind it (spec §6.3: "must not interrupt
 * a running activity").
 *
 * `dictionaryEnabled` is the seat's CURRENT DesiredStationState value
 * (live-session activity, spec §7) — a UX courtesy. The server enforces
 * the same policy independently on every call this panel makes
 * (DictionaryAccessGuard), so a stale/race-y snapshot here only ever
 * fails closed into the same "turned off" message, never open.
 */
export function DictionaryPanel({
  control,
  dictionaryEnabled,
}: {
  control: StationControlClient;
  dictionaryEnabled: boolean;
}) {
  const { open, query, pendingLookup, recent, disabledReason, setOpen, setQuery, clearPendingLookup, addRecent, clearRecent } =
    useDictionaryStore();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<DictionaryLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDisabled = !dictionaryEnabled || disabledReason !== null;

  // Focus the search box the moment the panel opens (Ctrl+D's own
  // contract — see shouldHandleDictionaryShortcut/StudentConsole).
  useEffect(() => {
    if (open && !isDisabled) inputRef.current?.focus();
  }, [open, isDisabled]);

  // Debounced type-ahead (spec §6.2: 150ms). A word already fully looked
  // up (query === result.headword after a lookup) still keeps suggesting
  // as the student edits it further — that's the point of type-ahead.
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!open || isDisabled || unavailable || !query.trim()) {
      setSuggestions([]);
      return;
    }
    suggestTimer.current = setTimeout(() => {
      stationApi
        .dictionarySuggest(control.getToken(), query.trim(), 8)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [query, open, isDisabled, unavailable, control]);

  // A trigger OUTSIDE this panel (a synonym chip in running exercise text,
  // the select-and-look-up popover) calls the store's openWith, which sets
  // this — run exactly one lookup for it, then clear it, so it never fires
  // again on an unrelated re-render.
  useEffect(() => {
    if (!pendingLookup || isDisabled) return;
    void runLookup(pendingLookup);
    clearPendingLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLookup, isDisabled]);

  async function runLookup(word: string): Promise<void> {
    const trimmed = word.trim();
    if (!trimmed || isDisabled) return;
    setQuery(trimmed);
    setSuggestions([]);
    setLoading(true);
    try {
      const res = await stationApi.dictionaryLookup(control.getToken(), trimmed);
      setResult(res);
      setUnavailable(false);
      addRecent({ word: trimmed, headword: res.headword, found: res.found, at: Date.now() });
    } catch (err) {
      // Spec §6.3: "Never a raw network error." A DICTIONARY_DISABLED here
      // (a snapshot that hadn't caught up with a teacher's toggle yet) is
      // covered by isDisabled re-evaluating on the next render once the
      // fresh snapshot arrives; in the meantime this reads the same as
      // "unavailable" to the student, which is the safe default either way.
      setResult(null);
      setUnavailable(!(err instanceof ApiError) || err.code !== 'DICTIONARY_DISABLED');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <aside
      data-dictionary-panel
      className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card text-card-foreground"
      aria-label="Dictionary"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <BookOpen className="h-4 w-4" /> Dictionary
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close dictionary"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isDisabled ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Dictionary is turned off for this activity.
        </div>
      ) : (
        <>
          <div className="relative border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                data-dictionary-search="true"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setResult(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runLookup(query);
                }}
                placeholder="Look up a word…"
                maxLength={64}
                className={cn(fieldClass, 'h-10 pl-8 pr-3')}
              />
            </div>
            {suggestions.length > 0 && (
              <ul className="absolute inset-x-3 top-[52px] z-10 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => void runLookup(s)}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up…
              </p>
            )}

            {!loading && unavailable && (
              <p className="text-sm text-muted-foreground">Dictionary unavailable — check with your teacher.</p>
            )}

            {!loading && !unavailable && result && (
              <DictionaryResultView result={result} onLookup={(w) => void runLookup(w)} />
            )}

            {!loading && !unavailable && !result && recent.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent lookups</p>
                  <button type="button" onClick={clearRecent} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear
                  </button>
                </div>
                {recent.map((r) => (
                  <button
                    key={r.word}
                    type="button"
                    onClick={() => void runLookup(r.word)}
                    className={cn(
                      'block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                      !r.found && 'text-muted-foreground italic',
                    )}
                  >
                    {r.word}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <button type="button" onClick={() => setAboutOpen(true)} className="underline decoration-dotted hover:text-foreground">
          Open English WordNet (CC BY 4.0), derived from Princeton WordNet — About &amp; licences
        </button>
      </div>
      <DictionaryAbout control={control} open={aboutOpen} onOpenChange={setAboutOpen} />
    </aside>
  );
}

function DictionaryResultView({ result, onLookup }: { result: DictionaryLookupResult; onLookup: (word: string) => void }) {
  if (!result.found) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No entry found for <span className="font-medium text-foreground">“{result.query}”</span>.
        </p>
        {result.suggestions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Did you mean</p>
            <div className="flex flex-wrap gap-1.5">
              {result.suggestions.map((s) => (
                <Button key={s} size="sm" variant="secondary" onClick={() => onLookup(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-semibold">{result.headword}</h3>
          {result.ipa && <span className="font-ipa text-sm text-muted-foreground">{result.ipa}</span>}
        </div>
        {result.resolvedFrom && (
          <p className="text-xs text-muted-foreground">
            from “{result.resolvedFrom}” → <span className="font-medium">{result.headword}</span>
          </p>
        )}
      </div>

      {result.entries.map((entry) => (
        <div key={entry.pos} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{entry.pos}</p>
          <ol className="space-y-2">
            {entry.senses.map((sense, i) => (
              <li key={i} className="text-sm">
                <span className="text-muted-foreground">{i + 1}. </span>
                {sense.definition}
                {sense.example && <p className="pl-4 text-xs italic text-muted-foreground">“{sense.example}”</p>}
                {sense.synonyms.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 pl-4">
                    {sense.synonyms.map((syn) => (
                      <Button key={syn} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onLookup(syn)}>
                        {syn}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
