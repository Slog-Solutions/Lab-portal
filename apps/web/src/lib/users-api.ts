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

export const usersApi = {
  list: (role?: UserRole) => apiFetch<UserRow[]>(`/users${role ? `?role=${role}` : ''}`),
};
