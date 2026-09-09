import { createHashRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { StatusBoardPage } from '../features/admin/StatusBoardPage';
import { SessionBuilderPage } from '../features/teacher/SessionBuilderPage';
import { MediaLibraryPage } from '../features/media/MediaLibraryPage';
import { ExercisesPage } from '../features/exercises/ExercisesPage';
import { ExerciseDetailPage } from '../features/exercises/ExerciseDetailPage';
import { StudyModulesPage } from '../features/courseware/StudyModulesPage';
import { GradebookPage } from '../features/gradebook/GradebookPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { StudentConsole } from '../features/student/StudentConsole';
import { ProtectedRoute } from './ProtectedRoute';
import { TeacherLayout } from './TeacherLayout';
import { getRuntimeConfig } from '../lib/runtime-config';

/**
 * createHashRouter — works byte-identically under app:// (Electron),
 * http:// (dev/browser) and any future file:// without server rewrites
 * (design doc §1.4). Upgrade path to BrowserRouter exists once the
 * desktop app:// handler grows an index.html fallback; not needed yet.
 *
 * `/student` is deliberately NOT behind a human login. Design doc §3.7 /
 * "Zero login friction": the STATION is the identity (machineGuid →
 * Station row), not a per-user account — a real seat must boot straight
 * into its console with no credentials typed. Gating it with
 * ProtectedRoute was a real bug caught in this pass: it meant the
 * student runtime (control socket, remote-control listener, broadcast
 * subscription) never even connected until a human "logged in" as a
 * student, which contradicts the whole point and silently broke
 * server-initiated features like remote control on an idle seat.
 *
 * Phase 3 adds four teacher/admin pages, nested under one TeacherLayout
 * (sidebar + single ProtectedRoute) instead of each page repeating both —
 * see TeacherLayout's own doc comment.
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <Navigate to={getRuntimeConfig().platform === 'desktop' ? '/student' : '/login'} replace />,
  },
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute roles={['ADMIN', 'TEACHER']}>
        <TeacherLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/dashboard', element: <StatusBoardPage /> },
      { path: '/sessions', element: <SessionBuilderPage /> },
      { path: '/media', element: <MediaLibraryPage /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/exercises/:id', element: <ExerciseDetailPage /> },
      { path: '/study-library', element: <StudyModulesPage /> },
      { path: '/gradebook', element: <GradebookPage /> },
      { path: '/reports', element: <ReportsPage /> },
    ],
  },
  { path: '/student', element: <StudentConsole /> },
]);
