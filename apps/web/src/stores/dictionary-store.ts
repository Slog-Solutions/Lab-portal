import { create } from 'zustand';

export interface RecentDictionaryLookup {
  word: string;
  headword: string | null;
  found: boolean;
  at: number;
}

const MAX_RECENT = 20;

interface DictionaryState {
  open: boolean;
  query: string;
  /** Set by openWith (a synonym chip elsewhere, the select-and-look-up
   * popover, a "Dictionary" nav item with a word in hand) — DictionaryPanel
   * watches this and runs exactly one lookup for it, then clears it. Kept
   * separate from `query` so typing in the search box never re-triggers a
   * lookup on every keystroke — only an explicit external request does. */
  pendingLookup: string | null;
  recent: RecentDictionaryLookup[];
  /** True while the currently-open activity/exercise has the dictionary
   * turned off (spec §7) — set from DesiredStationState.dictionaryEnabled
   * and from a started assignment attempt's own exercise.dictionaryEnabled.
   * Deliberately a client-side UX courtesy; the server enforces the same
   * policy independently on every /dictionary/* call. */
  disabledReason: 'activity' | 'test' | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Opens the panel pre-filled with a word AND runs the lookup — the
   * select-and-look-up affordance and any "look up this word" trigger
   * outside the panel itself go through this (spec §6.1, §6.2). */
  openWith: (word: string) => void;
  clearPendingLookup: () => void;
  setQuery: (query: string) => void;
  addRecent: (entry: RecentDictionaryLookup) => void;
  clearRecent: () => void;
  setDisabledReason: (reason: 'activity' | 'test' | null) => void;
  /** A seat is shared hardware — nothing from one student's session may
   * leak to the next (same posture as StudentConsole's own query-cache
   * clear on sign-out). */
  resetForNewStudent: () => void;
}

/**
 * The offline dictionary panel's client-side state (SPEC-offline-
 * dictionary.md §6). Deliberately NOT persisted (unlike useStudentSession)
 * — "Recent lookups… local to that student's session" means exactly the
 * current sign-in, not surviving a reload as a returning student's own
 * history would imply.
 */
export const useDictionaryStore = create<DictionaryState>((set) => ({
  open: false,
  query: '',
  pendingLookup: null,
  recent: [],
  disabledReason: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  openWith: (word) => set({ open: true, query: word, pendingLookup: word }),
  clearPendingLookup: () => set({ pendingLookup: null }),
  setQuery: (query) => set({ query }),
  addRecent: (entry) =>
    set((s) => ({ recent: [entry, ...s.recent.filter((r) => r.word !== entry.word)].slice(0, MAX_RECENT) })),
  clearRecent: () => set({ recent: [] }),
  setDisabledReason: (disabledReason) => set({ disabledReason }),
  resetForNewStudent: () => set({ open: false, query: '', pendingLookup: null, recent: [], disabledReason: null }),
}));
