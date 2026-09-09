import type { ActivityType } from '@lab/shared';
import { apiFetch } from './api-client';

export interface Exercise {
  id: string;
  teacherId: string;
  lessonId: string | null;
  type: ActivityType;
  title: string;
  config: unknown;
  createdAt: string;
  itemBank?: { id: string; _count: { items: number } } | null;
}

export interface Item {
  id: string;
  itemBankId: string;
  order: number;
  type: string;
  prompt: string;
  answer: string;
  choices: string[];
  cefrTag: string | null;
}

export const exercisesApi = {
  list: () => apiFetch<Exercise[]>('/exercises'),
  get: (id: string) => apiFetch<Exercise & { itemBank: { id: string; items: Item[] } | null }>(`/exercises/${id}`),
  create: (dto: { type: ActivityType; title: string; lessonId?: string; config: unknown }) =>
    apiFetch<Exercise>('/exercises', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, patch: { title?: string; config?: unknown }) =>
    apiFetch<Exercise>(`/exercises/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/exercises/${id}`, { method: 'DELETE' }),
  listItems: (id: string) => apiFetch<Item[]>(`/exercises/${id}/items`),
  setItems: (id: string, items: Array<Partial<Item> & { prompt: string; answer: string }>) =>
    apiFetch<Item[]>(`/exercises/${id}/items`, { method: 'PUT', body: JSON.stringify({ items }) }),
  importText: (id: string, text: string, append: boolean) =>
    apiFetch<Item[]>(`/exercises/${id}/items/import-text`, { method: 'POST', body: JSON.stringify({ text, append }) }),
};
