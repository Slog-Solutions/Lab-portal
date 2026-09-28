import { apiFetch } from './api-client';

export interface TopWordRow {
  word: string;
  count: number;
}

/** Teacher-facing side of the offline dictionary's lookup log
 * (SPEC-offline-dictionary.md §8) — "words your class looked up most" and
 * the one-click export into a Vocabulary Test item bank it feeds. */
export const dictionaryReportsApi = {
  topWords: (days: number, limit = 50) => apiFetch<TopWordRow[]>(`/dictionary/reports/top-words?days=${days}&limit=${limit}`),

  exportToItemBank: (title: string, words: string[]) =>
    apiFetch<{ exerciseId: string; itemCount: number }>('/dictionary/reports/export-to-item-bank', {
      method: 'POST',
      body: JSON.stringify({ title, words }),
    }),

  /** ADMIN only — the server rejects this for a plain TEACHER token. */
  purgeLogs: () => apiFetch<{ purged: number }>('/dictionary/reports/logs', { method: 'DELETE' }),
};
