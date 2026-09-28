import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DateBadgeProps {
  dayNumber: number | string;
  weekday: string;
  month: string;
  className?: string;
}

export function DateBadge({ dayNumber, weekday, month, className }: DateBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] py-1.5 pl-1.5 pr-3 text-[#14150F]',
        className,
      )}
    >
      <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[#17181A] text-xs font-bold text-[#F5F5F0]">
        <span>{dayNumber}</span>
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#D7F83C] ring-2 ring-[#F4F4EF]" />
      </div>
      <div className="flex flex-col text-left leading-none">
        <span className="text-[10px] font-medium text-[#6E7066]">{weekday}</span>
        <span className="text-xs font-semibold text-[#14150F]">{month}</span>
      </div>
    </div>
  );
}
