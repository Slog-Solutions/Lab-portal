import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Flat dashboard card: hairline border, no shadow, header row (title +
 * optional description on the left, actions on the right) above a body.
 * Separation between the two is spacing, not a rule.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex flex-col rounded-card border border-hairline bg-card text-card-foreground', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-snug text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export type StatTone = 'brand' | 'online' | 'pending' | 'offline' | 'info';

// Soft tile behind the widget icon, and the matching ink for the highlight
// figure in the footer — both from the same token so they can't drift.
const TONE: Record<StatTone, { tile: string; text: string }> = {
  brand: { tile: 'bg-brand-soft text-brand', text: 'text-brand' },
  online: { tile: 'bg-status-online/10 text-status-online', text: 'text-status-online' },
  pending: { tile: 'bg-status-pending/10 text-status-pending', text: 'text-status-pending' },
  offline: { tile: 'bg-status-offline/10 text-status-offline', text: 'text-status-offline' },
  info: { tile: 'bg-status-info/10 text-status-info', text: 'text-status-info' },
};

/**
 * KPI widget: small uppercase label, large figure, and a one-line footer
 * with a tinted highlight figure followed by a muted caption. The icon sits
 * in a soft square in the top-right corner.
 */
export function StatWidget({
  label,
  value,
  unit,
  icon: Icon,
  tone = 'brand',
  highlight,
  caption,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  tone?: StatTone;
  highlight?: ReactNode;
  caption?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className="rounded-card border border-hairline bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-control', t.tile)} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="-mt-1 flex items-baseline gap-1.5">
        <span className="text-[1.75rem] font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</span>
        {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
      </p>
      {(highlight || caption) && (
        <p className="mt-4 truncate text-xs text-muted-foreground">
          {highlight && <span className={cn('mr-1.5 font-semibold', t.text)}>{highlight}</span>}
          {caption}
        </p>
      )}
    </div>
  );
}
