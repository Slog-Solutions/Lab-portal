import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Users2,
  GraduationCap,
  ClipboardList,
  FileBarChart,
  LogOut,
  Building2,
  UserCog,
  Mic,
  School,
  Video,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth-store';
import { ASSIGNMENT_KINDS } from '../features/assignments/assignment-kinds';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/brand/BrandLogo';

const NAV = [
  { to: '/dashboard', label: 'Lab Control', icon: LayoutDashboard },
  { to: '/classes', label: 'My Classes', icon: School, teacherOnly: true },
  { to: '/sessions', label: 'Sessions', icon: Users2 },
  { to: '/pronunciation', label: 'Pronunciation', icon: Mic },
  { to: '/study-library', label: 'Study Library', icon: GraduationCap },
  { to: '/recordings', label: 'Recordings', icon: Video },
  { to: '/gradebook', label: 'Gradebook', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

const ASSIGNMENT_NAV = ASSIGNMENT_KINDS.map(({ slug, label, icon }) => ({ to: `/assignments/${slug}`, label, icon }));

const ADMIN_NAV = [
  { to: '/admin/batches', label: 'Batches', icon: Building2 },
  { to: '/admin/users', label: 'Users', icon: UserCog },
];

// The sidebar is the green chrome, so the active/inactive relationship is
// inverted from a light nav: active is a cream fill with green ink, and
// inactive text sits directly on the green.
function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'group flex items-center justify-between rounded-control px-3.5 py-2.5 text-sm font-medium transition-all duration-150',
    isActive
      ? 'bg-cream text-brand shadow-sm'
      : 'text-brand-ink-muted hover:bg-white/10 hover:text-brand-ink',
  );
}

export function TeacherLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="flex min-h-screen gap-4 bg-canvas p-3 text-foreground sm:p-4">
      {/* Brand chrome: the one full-green surface on a teacher screen. */}
      <aside className="flex w-60 shrink-0 flex-col rounded-card bg-brand p-4 text-brand-ink">
        <div className="border-b border-hairline-on-dark px-2 pb-4 pt-1">
          {/*
            The logo artwork is deep green on transparent, so it needs a light
            plate to sit on — placed directly on the green chrome it would be
            invisible. The cream plate is the same fill as an active nav item.
          */}
          <div className="rounded-control bg-cream px-3 py-2.5">
            {/* The wordmark carries the product name, so no adjacent <h1>. */}
            <BrandLogo variant="full" className="w-full" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-brand-ink-muted">{user?.fullName}</p>
            <span className="rounded-pill bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
              {user?.role}
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 py-3 overflow-y-auto">
          {NAV.filter((item) => !item.teacherOnly || !isAdmin).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClassName}>
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </div>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                </>
              )}
            </NavLink>
          ))}

          {/* Sentence-case section header per DESIGN_SYSTEM.md §3 */}
          <div className="px-3.5 pt-4 pb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-muted">Create assignment</p>
          </div>
          {ASSIGNMENT_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClassName}>
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </div>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                </>
              )}
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="px-3.5 pt-4 pb-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-muted">Administration</p>
              </div>
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={navLinkClassName}>
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </div>
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-hairline-on-dark pt-3">
          <button
            type="button"
            onClick={() => clear()}
            className="flex w-full items-center gap-2.5 rounded-control px-3.5 py-2 text-sm font-medium text-brand-ink-muted transition-colors hover:bg-white/10 hover:text-brand-ink"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main bento outlet */}
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
