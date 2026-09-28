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

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'group flex items-center justify-between rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150',
    isActive
      ? 'bg-[#17181A] text-[#F5F5F0] shadow-sm'
      : 'text-[#6E7066] hover:bg-[#E5E8DC] hover:text-[#14150F]',
  );
}

export function TeacherLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="flex min-h-screen bg-[#A9AF98] text-[#14150F] p-3 sm:p-4 gap-4">
      {/* Editorial Bento Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col rounded-[28px] border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] p-4 text-[#14150F]">
        <div className="border-b border-[rgba(20,21,15,0.08)] pb-4 pt-1 px-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#D7F83C] ring-2 ring-[#17181A]" />
            <h1 className="text-sm font-semibold tracking-tight text-[#14150F]">Digital Language Lab</h1>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs font-medium text-[#6E7066] truncate">{user?.fullName}</p>
            <span className="rounded-full bg-[#E5E8DC] px-2 py-0.5 text-[10px] font-semibold text-[#14150F]">
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
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-[#D7F83C]" />}
                </>
              )}
            </NavLink>
          ))}

          {/* Sentence-case section header per DESIGN_SYSTEM_LIME_BENTO.md §3 */}
          <div className="px-3.5 pt-4 pb-1">
            <p className="text-xs font-semibold text-[#6E7066]">Create assignment</p>
          </div>
          {ASSIGNMENT_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClassName}>
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </div>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-[#D7F83C]" />}
                </>
              )}
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="px-3.5 pt-4 pb-1">
                <p className="text-xs font-semibold text-[#6E7066]">Administration</p>
              </div>
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={navLinkClassName}>
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </div>
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-[#D7F83C]" />}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-[rgba(20,21,15,0.08)] pt-3">
          <button
            type="button"
            onClick={() => clear()}
            className="flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2 text-sm font-medium text-[#6E7066] transition-colors hover:bg-[#E5E8DC] hover:text-[#14150F]"
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
