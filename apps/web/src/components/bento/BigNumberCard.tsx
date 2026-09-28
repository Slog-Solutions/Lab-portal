import * as React from 'react';
import { BentoCard } from './BentoCard';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface BigNumberCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: LucideIcon;
  subtext?: string;
  variant?: 'light' | 'dark';
  className?: string;
  accentBadge?: string;
}

export function BigNumberCard({
  label,
  value,
  unit,
  icon: Icon,
  subtext,
  variant = 'light',
  className,
  accentBadge,
}: BigNumberCardProps) {
  const isDark = variant === 'dark';

  return (
    <BentoCard variant={variant} className={cn('flex flex-col justify-between overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full',
                isDark ? 'bg-white/10 text-white' : 'bg-black/5 text-[#14150F]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
          )}
          <span
            className={cn(
              'text-sm font-medium',
              isDark ? 'text-[#9A9C97]' : 'text-[#6E7066]',
            )}
          >
            {label}
          </span>
        </div>
        {accentBadge && (
          <span className="rounded-full bg-[#D7F83C] px-2.5 py-0.5 text-xs font-semibold text-[#14150F]">
            {accentBadge}
          </span>
        )}
      </div>

      <div className="my-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-hero-num">{value}</span>
          {unit && (
            <span
              className={cn(
                'text-lg font-medium',
                isDark ? 'text-[#9A9C97]' : 'text-[#6E7066]',
              )}
            >
              {unit}
            </span>
          )}
        </div>
      </div>

      {subtext && (
        <p
          className={cn(
            'text-xs font-normal',
            isDark ? 'text-[#9A9C97]' : 'text-[#6E7066]',
          )}
        >
          {subtext}
        </p>
      )}
    </BentoCard>
  );
}
