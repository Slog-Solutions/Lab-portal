import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Users2,
  // BookOpen, // only used by the commented-out Exercises link below
  GraduationCap,
  ClipboardList,
  FileBarChart,
  LogOut,
  Building2,
  UserCog,
  Mic,
  ClipboardCheck,
  School,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth-store';
import { ASSIGNMENT_KINDS } from '../features/assignments/assignment-kinds';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/dashboard', label: 'Lab Control', icon: LayoutDashboard },
  // Teachers create and run their own classes here; an ADMIN uses the
  // Batches pages instead (see router.tsx), so it is hidden for them.
  { to: '/classes', label: 'My Classes', icon: School, teacherOnly: true },
  { to: '/sessions', label: 'Sessions', icon: Users2 },
  // { to: '/exercises', label: 'Exercises', icon: BookOpen },
  { to: '/pronunciation', label: 'Pronunciation', icon: Mic },
  // { to: '/pronunciation-tests', label: 'Pronunciation Tests', icon: ClipboardCheck },
  { to: '/study-library', label: 'Study Library', icon: GraduationCap },
  { to: '/gradebook', label: 'Gradebook', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

// "Create Assignment" section — one link per assignment type, for both
// TEACHER and ADMIN. A results page (/assignments/<slug>/<id>) sits under
// its type's link, so NavLink's prefix match keeps the right one highlighted.
const ASSIGNMENT_NAV = ASSIGNMENT_KINDS.map(({ slug, label, icon }) => ({ to: `/assignments/${slug}`, label, icon }));

// ADMIN-only (server-enforced too — UsersController/BatchesController's
// write routes are ADMIN-only). Kept as a second group with its own
// heading rather than merged into NAV, so a TEACHER's sidebar never even
// shows a link that would just bounce them back to /login.
const ADMIN_NAV = [
  { to: '/admin/batches', label: 'Batches', icon: Building2 },
  { to: '/admin/users', label: 'Users', icon: UserCog },
];

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  );
}

/**
 * Every teacher/admin page nests under one TeacherLayout (sidebar +
 * ProtectedRoute) instead of each page repeating both — see router.tsx's
 * doc comment for the additional ADMIN-only nesting the LMS pages need.
 */
export function TeacherLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="text-sm font-semibold">Digital Language Lab</p>
          <p className="text-xs text-muted-foreground">{user?.fullName}</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.filter((item) => !item.teacherOnly || !isAdmin).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClassName}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Create Assignment</p>
          {ASSIGNMENT_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClassName}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin</p>
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={navLinkClassName}>
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <button
          type="button"
          onClick={() => clear()}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
