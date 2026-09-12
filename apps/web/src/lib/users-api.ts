import type { UserRole } from '@lab/shared';
import { apiFetch } from './api-client';

export interface UserRow {
  id: string;
  serviceNumber: string;
  fullName: string;
  role: UserRole;
  rank: string | null;
  active: boolean;
}

export interface CreateUserInput {
  serviceNumber: string;
  fullName: string;
  role: UserRole;
  password: string;
  rank?: string;
}

export const usersApi = {
  list: (role?: UserRole) => apiFetch<UserRow[]>(`/users${role ? `?role=${role}` : ''}`),
  create: (dto: CreateUserInput) => apiFetch<UserRow>('/users', { method: 'POST', body: JSON.stringify(dto) }),
  setActive: (id: string, active: boolean) =>
    apiFetch<UserRow>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  resetPassword: (id: string, password: string) =>
    apiFetch<{ ok: true }>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
};
