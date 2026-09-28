import * as React from 'react';
import { BentoCard } from './BentoCard';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Play, Square, Bell, Info } from 'lucide-react';

export interface HeroCardProps {
  teacherName: string;
  teacherRole?: string;
  avatarUrl?: string;
  title: string;
  metadata?: string;
  progressPercent?: number;
  progressLabel?: string;
  actionLabel?: string;
  isActionActive?: boolean;
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryControl?: React.ReactNode;
  statusBadge?: string;
  className?: string;
}

export function HeroCard({
  teacherName,
  teacherRole = 'Teacher',
  avatarUrl,
  title,
  metadata,
  progressPercent = 0,
  progressLabel,
  actionLabel = 'Start session',
  isActionActive = false,
  onAction,
  actionDisabled = false,
  secondaryControl,
  statusBadge,
  className,
}: HeroCardProps) {
  const initials = teacherName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <BentoCard variant="light" className={cn('flex flex-col justify-between', className)}>
      {/* Top row: Profile & icons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={teacherName}
              className="h-10 w-10 rounded-full object-cover border border-black/10"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17181A] text-xs font-semibold text-[#F5F5F0]">
              {initials}
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-[#14150F] leading-tight">{teacherName}</h3>
            <p className="text-xs text-[#6E7066] leading-tight">{teacherRole}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {statusBadge && (
            <span className="rounded-full bg-[#17181A] px-2.5 py-0.5 text-xs font-medium text-[#F5F5F0]">
              {statusBadge}
            </span>
          )}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-[#14150F] transition-colors hover:bg-black/10"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Middle row: Large session title & metadata */}
      <div className="my-5">
        <h2 className="text-card-title text-[#14150F]">{title}</h2>
        {metadata && <p className="mt-1 text-sm text-[#6E7066]">{metadata}</p>}

        {/* Thin progress bar with percentage */}
        {progressPercent !== undefined && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-[#6E7066]">
              <span>{progressLabel ?? 'Session completion'}</span>
              <span className="font-semibold text-[#14150F]">{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E8DC]">
              <div
                className="h-full rounded-full bg-[#17181A] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer row: Dropdown / secondary control & Circular / pill action button */}
      <div className="flex items-center justify-between gap-3 border-t border-[rgba(20,21,15,0.08)] pt-4">
        <div className="flex-1 min-w-0">{secondaryControl}</div>

        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed',
            isActionActive
              ? 'bg-[#17181A] text-[#F5F5F0] hover:bg-black'
              : 'bg-[#D7F83C] text-[#14150F] hover:bg-[#c5e434]',
          )}
        >
          {isActionActive ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          <span>{actionLabel}</span>
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full',
              isActionActive ? 'bg-white/10 text-white' : 'bg-[#14150F] text-[#D7F83C]',
            )}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
        </button>
      </div>
    </BentoCard>
  );
}
