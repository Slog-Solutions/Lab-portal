import { createHashRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { StatusBoardPage } from '../features/admin/StatusBoardPage';
import { BatchesPage } from '../features/admin/BatchesPage';
import { BatchDetailPage } from '../features/admin/BatchDetailPage';
import { UsersPage } from '../features/admin/UsersPage';
import { SessionBuilderPage } from '../features/teacher/SessionBuilderPage';
import { MediaLibraryPage } from '../features/media/MediaLibraryPage';
import { ExercisesPage } from '../features/exercises/ExercisesPage';
import { ExerciseDetailPage } from '../features/exercises/ExerciseDetailPage';
import { StudyModulesPage } from '../features/courseware/StudyModulesPage';
import { GradebookPage } from '../features/gradebook/GradebookPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { StudentConsole } from '../features/student/StudentConsole';
import { PronunciationAuthoringPage } from '../features/exercises/PronunciationAuthoringPage';
import { PronunciationReviewPage } from '../features/exercises/PronunciationReviewPage';
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
 * All teacher/admin pages nest under one TeacherLayout (sidebar + a
 * shared ADMIN|TEACHER ProtectedRoute) instead of each page repeating
 * both — see TeacherLayout's own doc comment. The LMS admin pages
 * (batches, users) nest an additional ADMIN-only ProtectedRoute one
 * level deeper, since TEACHER can reach the layout but not these routes.
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
      {
        path: '/admin/batches',
        element: (
          <ProtectedRoute roles={['ADMIN']}>
            <BatchesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/batches/:id',
        element: (
          <ProtectedRoute roles={['ADMIN']}>
            <BatchDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/users',
        element: (
          <ProtectedRoute roles={['ADMIN']}>
            <UsersPage />
          </ProtectedRoute>
        ),
      },
      { path: '/sessions', element: <SessionBuilderPage /> },
      { path: '/media', element: <MediaLibraryPage /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/exercises/:id', element: <ExerciseDetailPage /> },
      { path: '/pronunciation', element: <PronunciationAuthoringPage /> },
      { path: '/pronunciation/:id/review', element: <PronunciationReviewPage /> },
      { path: '/study-library', element: <StudyModulesPage /> },
      { path: '/gradebook', element: <GradebookPage /> },
      { path: '/reports', element: <ReportsPage /> },
    ],
  },
  { path: '/student', element: <StudentConsole /> },
]);
