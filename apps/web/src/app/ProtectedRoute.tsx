import type { PropsWithChildren } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore, type AuthUser } from '../stores/auth-store';

export function ProtectedRoute({ roles, children }: PropsWithChildren<{ roles?: AuthUser['role'][] }>) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
