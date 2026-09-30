import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronUp,
  AppWindow,
  Globe,
  Keyboard,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Power,
  RotateCcw,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  Unlock,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type BulkAction =
  | 'lock-screen'
  | 'lock-input'
  | 'unlock'
  | 'message'
  | 'open-url'
  | 'launch-program'
  | 'wake'
  | 'restart'
  | 'shutdown'
  | 'windows-lock'
  | 'disable'
  | 'enable';

interface MenuItem {
  action: BulkAction;
  label: string;
  hint: string;
  icon: LucideIcon;
  danger?: boolean;
}

// Less frequent or riskier commands live behind "More" so the everyday four
// stay one click away and a misclick can't power off a room.
const MORE: MenuItem[][] = [
  [
    { action: 'open-url', label: 'Open website', hint: 'Open a page in students’ browsers', icon: Globe },
    { action: 'launch-program', label: 'Launch program', hint: 'Start an allowlisted app', icon: AppWindow },
  ],
  [
    { action: 'wake', label: 'Wake (Wake-on-LAN)', hint: 'Power on sleeping PCs', icon: Zap },
    { action: 'restart', label: 'Restart', hint: 'Reboot the PCs', icon: RotateCcw },
    { action: 'shutdown', label: 'Shut down', hint: 'Asks to confirm', icon: Power, danger: true },
  ],
  [
    { action: 'windows-lock', label: 'Windows lock', hint: 'Only the studentâ€™s password releases it', icon: ShieldAlert },
    { action: 'disable', label: 'Disable console', hint: 'Block the lab app', icon: ToggleLeft },
    { action: 'enable', label: 'Enable console', hint: 'Restore the lab app', icon: ToggleRight },
  ],
];

function MoreMenu({ disabled, onAction }: { disabled: boolean; onAction: (a: BulkAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal />
        More
        <ChevronUp className={cn('transition-transform', !open && 'rotate-180')} />
      </Button>
      {open && (
        <div role="menu" className="absolute bottom-full right-0 z-30 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-control sm:left-0 sm:right-auto border border-hairline bg-card p-1.5">
          {MORE.map((group, gi) => (
            <div key={gi} className={cn(gi > 0 && 'mt-1.5 border-t border-hairline pt-1.5')}>
              {group.map(({ action, label, hint, icon: Icon, danger }) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onAction(action);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-accent',
                    danger ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[11px] text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The contextual action bar: appears once seats are selected and sticks to
 * the bottom of the viewport while the seat panel is on screen.
 */
export function SelectionBar({
  count,
  studentCount,
  busy,
  onAction,
  onCreateActivity,
  onClear,
}: {
  count: number;
  /** Selected seats that are student seats (not the teacher's). */
  studentCount: number;
  busy: boolean;
  onAction: (a: BulkAction) => void;
  onCreateActivity: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-20 mt-5 flex flex-wrap items-center gap-2 rounded-card border border-brand/25 bg-card p-2.5 pl-4">
      <div className="mr-2 flex items-center gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />}
        <span className="text-sm font-semibold text-foreground tabular-nums">{count} selected</span>
      </div>

      <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction('lock-screen')}>
        <Lock />
        Lock screen
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || studentCount === 0}
        title="Blocks keyboard and mouse only â€” the screen stays visible"
        onClick={() => onAction('lock-input')}
      >
        <Keyboard />
        Lock input
      </Button>
      <Button variant="outline" size="sm" disabled={busy} className="text-status-online hover:text-status-online" onClick={() => onAction('unlock')}>
        <Unlock />
        Unlock
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction('message')}>
        <MessageSquare />
        Message
      </Button>
      <MoreMenu disabled={busy} onAction={onAction} />

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" disabled={busy || studentCount === 0} onClick={onCreateActivity}>
          Create activity
          <ArrowRight />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection">
          <X />
        </Button>
      </div>
    </div>
  );
}
