import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  MonitorCog,
  Users2,
  BookOpenCheck,
  GraduationCap,
  ClipboardList,
  FileBarChart,
  LogOut,
  Building2,
  UserCog,
  Mic,
  School,
  Video,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth-store';
import { classroomApi } from '../lib/classroom-api';
import { ASSIGNMENT_KINDS } from '../features/assignments/assignment-kinds';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/brand/BrandLogo';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  teacherOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Lab Control', icon: LayoutDashboard },
  { to: '/class-control', label: 'Class Control', icon: MonitorCog },
  { to: '/classes', label: 'My Classes', icon: School, teacherOnly: true },
  { to: '/sessions', label: 'Sessions', icon: Users2 },
  { to: '/pronunciation', label: 'Pronunciation', icon: Mic },
  { to: '/study-library', label: 'Study Library', icon: GraduationCap },
  { to: '/content-exercises', label: 'Content Exercises', icon: BookOpenCheck },
  { to: '/recordings', label: 'Recordings', icon: Video },
  { to: '/gradebook', label: 'Gradebook', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

const ASSIGNMENT_NAV: NavItem[] = ASSIGNMENT_KINDS.map(({ slug, label, icon }) => ({ to: `/assignments/${slug}`, label, icon }));

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/batches', label: 'Batches', icon: Building2 },
  { to: '/admin/users', label: 'Users', icon: UserCog },
];

const COLLAPSE_KEY = 'lab.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/**
 * Admin-console shell: a fixed full-height green sidebar (grouped menu with
 * small uppercase section titles), a flat topbar across the content column,
 * and a padded content area with a footer. Flat throughout — separation is
 * hairlines and spacing, never shadows.
 *
 * On lg+ the topbar toggle condenses the sidebar to an icon rail (remembered
 * per browser); below lg the sidebar is off-canvas and the toggle opens it.
 */
export function TeacherLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const isAdmin = user?.role === 'ADMIN';
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Shares the cache entry with the dashboard's class card and LiveClassCard.
  const { data: currentClass } = useQuery({ queryKey: ['classroom', 'current'], queryFn: classroomApi.current });
  const classLive = currentClass?.state === 'ACTIVE';

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function toggleSidebar(): void {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
        } catch {
          // Storage unavailable — the preference just won't persist.
        }
        return next;
      });
    } else {
      setMobileOpen((v) => !v);
    }
  }

  // On mobile the drawer is always full width, whatever the desktop preference.
  const rail = collapsed && !mobileOpen;

  const renderItems = (items: NavItem[]) =>
    items.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        title={rail ? label : undefined}
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-3 py-2.5 text-sm transition-colors',
            rail ? 'lg:justify-center lg:px-0 px-6' : 'px-6',
            isActive ? 'bg-white/[0.08] font-semibold text-cream' : 'font-medium text-brand-ink-muted hover:text-brand-ink',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-pill bg-cream" aria-hidden />}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className={cn('truncate', rail && 'lg:sr-only')}>{label}</span>
          </>
        )}
      </NavLink>
    ));

  // In the icon rail a group title becomes a short rule — except the first,
  // which would just double the border under the logo.
  const sectionTitle = (text: string, first = false) =>
    rail ? (
      first ? (
        <div className="hidden h-3 lg:block" aria-hidden />
      ) : (
        <div className="mx-auto my-3 hidden h-px w-8 bg-hairline-on-dark lg:block" aria-hidden />
      )
    ) : (
      <p className="px-6 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-ink-muted/80">{text}</p>
    );

  return (
    <div className="min-h-screen bg-canvas text-foreground">
      {/* Mobile scrim */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
        />
      )}

      {/* Sidebar — the one full-green surface on a teacher screen. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-brand text-brand-ink transition-[width,transform] duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          rail && 'lg:w-[72px]',
        )}
      >
        {/* Logo row lines up with the topbar height. The artwork is deep green
            on transparent, so it sits on a cream plate (DESIGN_SYSTEM.md §4). */}
        {/*
          Brand lockup: the square mark on a cream tile (the artwork is deep
          green on transparent, so it needs a light plate — DESIGN_SYSTEM.md
          §4) beside the product name set as live text. The full PNG wordmark
          renders "Language Lab" too small to read at sidebar size.
        */}
        <div
          className={cn(
            'flex h-[70px] shrink-0 items-center gap-3 border-b border-hairline-on-dark',
            rail ? 'px-5 lg:justify-center lg:px-0' : 'px-5',
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-cream">
            <BrandLogo variant="mark" decorative className="h-8 w-8" />
          </span>
          <div className={cn('min-w-0 flex-1 leading-tight', rail && 'lg:hidden')}>
            <p className="truncate text-[15px] font-bold tracking-tight text-cream">Digital</p>
            <p className="truncate text-xs font-medium text-brand-ink-muted">Language Lab</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-control p-1.5 text-brand-ink-muted hover:text-brand-ink lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="sidebar-scroll flex-1 overflow-y-auto pb-6">
          {sectionTitle('Navigation', true)}
          {renderItems(NAV.filter((item) => !item.teacherOnly || !isAdmin))}

          {sectionTitle('Create assignment')}
          {renderItems(ASSIGNMENT_NAV)}

          {isAdmin && (
            <>
              {sectionTitle('Administration')}
              {renderItems(ADMIN_NAV)}
            </>
          )}
        </nav>
      </aside>

      {/* Content column */}
      <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', rail ? 'lg:pl-[72px]' : 'lg:pl-[260px]')}>
        <header className="sticky top-0 z-20 flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-hairline bg-card px-4 sm:px-6">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Toggle menu"
            className="rounded-control p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-brand"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 sm:gap-5">
            {currentClass && (
              <span
                className={cn(
                  'hidden items-center gap-2 rounded-pill px-3 py-1 text-xs font-semibold sm:inline-flex',
                  classLive ? 'bg-status-online/10 text-status-online' : 'bg-muted text-muted-foreground',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', classLive ? 'bg-status-online' : 'bg-muted-foreground')} />
                {classLive ? `Class live · ${currentClass.code}` : 'No class running'}
              </span>
            )}

            <div className="flex items-center gap-3 border-l border-hairline pl-3 sm:pl-5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-bold text-brand"
                aria-hidden
              >
                {initials(user?.fullName)}
              </span>
              <div className="hidden min-w-0 leading-tight sm:block">
                <p className="max-w-[180px] truncate text-sm font-semibold text-foreground">{user?.fullName}</p>
                <p className="text-[11px] font-medium text-muted-foreground">{isAdmin ? 'Administrator' : 'Instructor'}</p>
              </div>
              <button
                type="button"
                onClick={() => clear()}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-control p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} Digital Language Lab</span>
          <span>ACTC No 2 TRG BN, ASC Centre (South)</span>
        </footer>
      </div>
    </div>
  );
}
