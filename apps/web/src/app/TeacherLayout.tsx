import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users2, FolderOpen, BookOpen, GraduationCap, ClipboardList, FileBarChart, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/auth-store';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/dashboard', label: 'Lab Control', icon: LayoutDashboard },
  { to: '/sessions', label: 'Sessions', icon: Users2 },
  { to: '/media', label: 'Media Library', icon: FolderOpen },
  { to: '/exercises', label: 'Exercises', icon: BookOpen },
  { to: '/study-library', label: 'Study Library', icon: GraduationCap },
  { to: '/gradebook', label: 'Gradebook', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

/**
 * Phase 3's four new pages made the old two-page `<Link>` ping-pong
 * (StatusBoardPage <-> SessionBuilderPage) stop scaling — this hoists
 * ProtectedRoute + navigation to one parent layout route so each child
 * page stops repeating both.
 */
export function TeacherLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="text-sm font-semibold">Digital Language Lab</p>
          <p className="text-xs text-muted-foreground">{user?.fullName}</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
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
