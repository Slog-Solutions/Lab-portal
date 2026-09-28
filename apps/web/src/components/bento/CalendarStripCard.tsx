import * as React from 'react';
import { BentoCard } from './BentoCard';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon, ChevronRight } from 'lucide-react';

export interface DayCell {
  dayOfWeek: string; // "Mon", "Tue"
  dateNum: number;   // 28
  isToday?: boolean;
  hasSessions?: boolean;
}

export interface CalendarStripCardProps {
  title?: string;
  subtitle?: string;
  monthLabel?: string;
  days?: DayCell[];
  selectedDay?: number;
  onSelectDay?: (day: number) => void;
  nextSessionText?: string;
  className?: string;
}

export function CalendarStripCard({
  title = 'Upcoming schedule',
  subtitle = '4 classes today',
  monthLabel = 'September 2026',
  days,
  selectedDay,
  onSelectDay,
  nextSessionText = 'Next: Period 3 Phonetics · 14:00',
  className,
}: CalendarStripCardProps) {
  // Generate current week days if not provided
  const currentDays: DayCell[] = days ?? [
    { dayOfWeek: 'Mon', dateNum: 28, isToday: true, hasSessions: true },
    { dayOfWeek: 'Tue', dateNum: 29, hasSessions: true },
    { dayOfWeek: 'Wed', dateNum: 30, hasSessions: true },
    { dayOfWeek: 'Thu', dateNum: 1, hasSessions: true },
    { dayOfWeek: 'Fri', dateNum: 2, hasSessions: true },
    { dayOfWeek: 'Sat', dateNum: 3, hasSessions: false },
  ];

  const activeDay = selectedDay ?? currentDays.find((d) => d.isToday)?.dateNum ?? currentDays[0]?.dateNum;

  return (
    <BentoCard variant="light" className={cn('flex flex-col justify-between', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#14150F]">{title}</h3>
          <p className="text-xs text-[#6E7066]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-[#14150F]">
          <CalendarIcon className="h-3 w-3 text-[#6E7066]" />
          <span>{monthLabel}</span>
        </div>
      </div>

      {/* Horizontal row of day cells */}
      <div className="my-4 grid grid-cols-6 gap-2">
        {currentDays.map((d) => {
          const isActive = d.dateNum === activeDay;
          return (
            <button
              key={`${d.dayOfWeek}-${d.dateNum}`}
              type="button"
              onClick={() => onSelectDay?.(d.dateNum)}
              className={cn(
                'group flex flex-col items-center justify-center rounded-2xl py-2.5 transition-all duration-150',
                isActive
                  ? 'bg-[#D7F83C] text-[#14150F] font-semibold'
                  : 'bg-[#E5E8DC]/70 hover:bg-[#E5E8DC] text-[#14150F]',
              )}
            >
              <span className={cn('text-[11px] font-medium leading-none mb-1', isActive ? 'text-[#14150F]' : 'text-[#6E7066]')}>
                {d.dayOfWeek}
              </span>
              <span className="text-sm font-semibold leading-none">{d.dateNum}</span>
              {d.hasSessions && !isActive && (
                <span className="mt-1 h-1 w-1 rounded-full bg-[#14150F]/40" />
              )}
              {isActive && (
                <span className="mt-1 h-1 w-1 rounded-full bg-[#14150F]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom info row */}
      <div className="flex items-center justify-between border-t border-[rgba(20,21,15,0.08)] pt-3 text-xs text-[#6E7066]">
        <span>{nextSessionText}</span>
        <div className="flex items-center gap-1 text-[#14150F] font-medium hover:underline cursor-pointer">
          <span>View</span>
          <ChevronRight className="h-3 w-3" />
        </div>
      </div>
    </BentoCard>
  );
}
