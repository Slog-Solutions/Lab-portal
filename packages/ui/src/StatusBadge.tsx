import type { StationLifecycle } from '@lab/shared';
import { cn } from './cn';

const STYLES: Record<StationLifecycle, string> = {
  UNCLAIMED: 'border-slate-700 bg-slate-900 text-slate-500',
  OFFLINE: 'border-slate-800 bg-slate-900 text-slate-600',
  JOINING: 'border-amber-600 bg-amber-950 text-amber-300',
  READY: 'border-emerald-600 bg-emerald-950 text-emerald-300',
  ACTIVE: 'border-sky-500 bg-sky-950 text-sky-300',
  LOCKED: 'border-red-500 bg-red-950 text-red-300',
  ERROR: 'border-red-600 bg-red-900 text-red-200',
};

const LABELS: Record<StationLifecycle, string> = {
  UNCLAIMED: 'Unclaimed',
  OFFLINE: 'Offline',
  JOINING: 'Joining',
  READY: 'Ready',
  ACTIVE: 'Active',
  LOCKED: 'Locked',
  ERROR: 'Error',
};

/**
 * The one place station-lifecycle → color/label mapping is defined.
 * apps/web's StatusBoardPage seat grid currently inlines an equivalent
 * mapping (Phase 0, written before this package existed) — migrating it
 * to consume this component is a Phase 1 cleanup, not a behavior change.
 */
export function StatusBadge({ lifecycle, className }: { lifecycle: StationLifecycle; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STYLES[lifecycle],
        className,
      )}
    >
      {LABELS[lifecycle]}
    </span>
  );
}
