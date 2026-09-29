import { BookOpen, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Mic, School, Search, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { StudentSessionUser } from '../../stores/student-session-store';

/** The screens a signed-in student can move between. `class` is the live
 * classroom view (teacher broadcast, live activities); `classes` is the
 * student's classes (join one, open one to see what they did there). */
export type StudentSection = 'home' | 'class' | 'classes' | 'assignments' | 'study' | 'pronunciation';

export const SECTION_TITLES: Record<StudentSection, string> = {
  home: 'Home',
  class: 'Live Class',
  classes: 'My Classes',
  assignments: 'Assignments',
  study: 'Study Material',
  pronunciation: 'Pronunciation',
};

const NAV: Array<{ section: StudentSection; icon: LucideIcon }> = [
  { section: 'home', icon: LayoutDashboard },
  { section: 'class', icon: School },
  { section: 'classes', icon: BookOpen },
  { section: 'assignments', icon: ClipboardList },
  { section: 'study', icon: GraduationCap },
  { section: 'pronunciation', icon: Mic },
];

/**
 * The student's side drawer — hidden until the header's menu button opens
 * it, and closed again after an item is picked. Item styling matches
 * TeacherLayout's sidebar links so both apps read as one product.
 * `inLiveClass` puts a pulsing dot on "Live Class" so a student browsing
 * another screen can tell their seat is currently attached to a live class.
 */
export function StudentDrawer({
  open,
  onOpenChange,
  section,
  onSelect,
  student,
  seatText,
  inLiveClass,
  onOpenDictionary,
  onSignOut,
  signingOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: StudentSection;
  onSelect: (section: StudentSection) => void;
  student: StudentSessionUser;
  seatText: string | null;
  inLiveClass: boolean;
  /** Offline dictionary (spec §6.1) — a permanent sidebar item that opens
   * the docked panel rather than switching `section`: the dictionary
   * coexists with whatever section is showing, it doesn't replace it. */
  onOpenDictionary: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <div className="border-b border-border px-4 py-4 pr-10">
          <SheetTitle>Digital Language Lab</SheetTitle>
          <SheetDescription className="mt-1">
            {student.fullName}
            <span className="block">
              {student.serviceNumber}
              {seatText ? ` · ${seatText}` : ''}
            </span>
          </SheetDescription>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Student sections">
          {NAV.map(({ section: item, icon: Icon }) => (
            <button
              key={item}
              type="button"
              aria-current={item === section ? 'page' : undefined}
              onClick={() => {
                onSelect(item);
                onOpenChange(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors',
                item === section
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{SECTION_TITLES[item]}</span>
              {item === 'class' && inLiveClass && (
                <span className="flex items-center gap-1 text-xs font-semibold text-status-online">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-online" />
                  Live
                </span>
              )}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => {
            onOpenDictionary();
            onOpenChange(false);
          }}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          Dictionary
        </button>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </SheetContent>
    </Sheet>
  );
}
