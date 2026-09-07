import { createHashRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { StatusBoardPage } from '../features/admin/StatusBoardPage';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * createHashRouter — works byte-identically under app:// (Electron),
 * http:// (dev/browser) and any future file:// without server rewrites
 * (design doc §1.4). Upgrade path to BrowserRouter exists once the
 * desktop app:// handler grows an index.html fallback; not needed yet.
 */
export const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute roles={['ADMIN', 'TEACHER']}>
        <StatusBoardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/student',
    // Student client UI lands in Phase 1 alongside session/lock state.
    element: (
      <ProtectedRoute roles={['STUDENT']}>
        <div className="p-8 text-slate-50">Student console — Phase 1</div>
      </ProtectedRoute>
    ),
  },
]);
