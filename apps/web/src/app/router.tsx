import { createHashRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { LabOverviewPage } from '../features/lab/LabOverviewPage';
import { ClassControlPage } from '../features/lab/ClassControlPage';
import { BatchesPage } from '../features/admin/BatchesPage';
import { BatchDetailPage } from '../features/admin/BatchDetailPage';
import { UsersPage } from '../features/admin/UsersPage';
import { RoundTableMonitorPage } from '../features/teacher/round-table/RoundTableMonitorPage';
import { SessionBuilderPage } from '../features/teacher/SessionBuilderPage';
import { MyClassesPage } from '../features/teacher/MyClassesPage';
import { ClassDetailPage } from '../features/teacher/ClassDetailPage';
import { ExercisesPage } from '../features/exercises/ExercisesPage';
import { ExerciseDetailPage } from '../features/exercises/ExerciseDetailPage';
import { StudyLibraryPage } from '../features/courseware/StudyLibraryPage';
import { TranslationPage } from '../features/translation/TranslationPage';
import { GradebookPage } from '../features/gradebook/GradebookPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { ClassRecordingsPage } from '../features/recordings/ClassRecordingsPage';
import { StudentConsole } from '../features/student/StudentConsole';
import { PronunciationAuthoringPage } from '../features/exercises/PronunciationAuthoringPage';
import { PronunciationReviewPage } from '../features/exercises/PronunciationReviewPage';
import { PronunciationTestsPage } from '../features/exercises/PronunciationTestsPage';
import { PronunciationTestResultsPage } from '../features/exercises/PronunciationTestResultsPage';
import { CreateAssignmentPage } from '../features/assignments/CreateAssignmentPage';
import { AssignmentResultsPage } from '../features/assignments/AssignmentResultsPage';
import { LiveTestBoardPage } from '../features/teacher/tests/LiveTestBoardPage';
import { ContentExercisesPage } from '../features/content/ContentExercisesPage';
import { ContentExerciseReportPage } from '../features/content/ContentExerciseReportPage';
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
      { path: '/dashboard', element: <LabOverviewPage /> },
      { path: '/class-control', element: <ClassControlPage /> },
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
      // TEACHER-only: an ADMIN creates and manages classes on the Batches
      // pages above (explicit code + key), so the sidebar hides this pair
      // for them too rather than bouncing them to /login.
      {
        path: '/classes',
        element: (
          <ProtectedRoute roles={['TEACHER']}>
            <MyClassesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/classes/:id',
        element: (
          <ProtectedRoute roles={['TEACHER']}>
            <ClassDetailPage />
          </ProtectedRoute>
        ),
      },
      { path: '/sessions', element: <SessionBuilderPage /> },
      { path: '/sessions/:sessionId/round-table', element: <RoundTableMonitorPage /> },
      // The Media Library was merged into the Study Library page (Files tab).
      { path: '/media', element: <Navigate to="/study-library?tab=files" replace /> },
      { path: '/exercises', element: <ExercisesPage /> },
      { path: '/exercises/:id', element: <ExerciseDetailPage /> },
      { path: '/pronunciation', element: <PronunciationAuthoringPage /> },
      { path: '/pronunciation/:id/review', element: <PronunciationReviewPage /> },
      { path: '/pronunciation-tests', element: <PronunciationTestsPage /> },
      { path: '/pronunciation-tests/:id', element: <PronunciationTestResultsPage /> },
      // "Create Assignment": vocabulary | writing | listening (see assignment-kinds.ts).
      { path: '/assignments', element: <Navigate to="/assignments/vocabulary" replace /> },
      { path: '/assignments/:kind', element: <CreateAssignmentPage /> },
      { path: '/assignments/:kind/:id', element: <AssignmentResultsPage /> },
      // SPEC-mcq-test-timed-reveal.md §7.3 — a launched vocabulary test's
      // live board, keyed by the ActivityInstance id (not a session/group id).
      { path: '/tests/live/:instanceId', element: <LiveTestBoardPage /> },
      { path: '/study-library', element: <StudyLibraryPage /> },
      { path: '/speech-translation', element: <TranslationPage /> },
      // Ser 4 Content Exercise: ready-made + publisher content, grade/level-wise.
      { path: '/content-exercises', element: <ContentExercisesPage /> },
      { path: '/content-exercises/:id', element: <ContentExerciseReportPage /> },
      { path: '/gradebook', element: <GradebookPage /> },
      { path: '/reports', element: <ReportsPage /> },
      { path: '/recordings', element: <ClassRecordingsPage /> },
    ],
  },
  { path: '/student', element: <StudentConsole /> },
]);
