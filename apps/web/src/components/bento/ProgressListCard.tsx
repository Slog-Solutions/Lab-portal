import * as React from 'react';
import { BentoCard } from './BentoCard';
import { cn } from '@/lib/utils';
import { Plus, ArrowRight } from 'lucide-react';

export interface ProgressItem {
  id: string;
  label: string;
  category?: string;
  percentage: number;
  studentsCount?: number;
  badge?: string;
}

export interface ProgressListCardProps {
  title?: string;
  subtitle?: string;
  actionText?: string;
  onAction?: () => void;
  items?: ProgressItem[];
  className?: string;
}

export function ProgressListCard({
  title = 'Curriculum roadmap',
  subtitle = 'CEFR units & skill mastery',
  actionText = '+ Add unit',
  onAction,
  items,
  className,
}: ProgressListCardProps) {
  const defaultItems: ProgressItem[] = items ?? [
    { id: '1', label: 'Unit 3: Phonetics & Intonation', category: 'A2 Basic', percentage: 88, studentsCount: 38, badge: 'Target met' },
    { id: '2', label: 'Unit 4: Conversational Fluency', category: 'B1 Intermediate', percentage: 64, studentsCount: 32 },
    { id: '3', label: 'Unit 5: Technical Terminology', category: 'B2 Professional', percentage: 42, studentsCount: 29 },
  ];

  return (
    <BentoCard variant="light" className={cn('flex flex-col justify-between', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#14150F]">{title}</h3>
          <p className="text-xs text-[#6E7066]">{subtitle}</p>
        </div>
        {actionText && (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-[#14150F] transition-colors hover:bg-black/10"
          >
            <Plus className="h-3 w-3" />
            <span>{actionText}</span>
          </button>
        )}
      </div>

      {/* Progress rows with today marker line */}
      <div className="relative my-4 space-y-3.5">
        {/* Subtle vertical indicator line */}
        <div className="absolute left-[65%] top-0 bottom-0 w-[1px] bg-black/10 pointer-events-none z-0">
          <span className="absolute -top-3.5 -translate-x-1/2 text-[9px] font-semibold text-[#6E7066]">
            Target
          </span>
        </div>

        {defaultItems.map((item) => (
          <div key={item.id} className="relative z-10 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-medium text-[#14150F] truncate">{item.label}</span>
                {item.category && (
                  <span className="rounded-full bg-[#E5E8DC] px-2 py-0.5 text-[10px] text-[#6E7066]">
                    {item.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.badge && (
                  <span className="rounded-full bg-[#D7F83C] px-2 py-0.5 text-[10px] font-semibold text-[#14150F]">
                    {item.badge}
                  </span>
                )}
                <span className="font-semibold text-[#14150F]">{item.percentage}%</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E8DC]">
              <div
                className="h-full rounded-full bg-[#17181A] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-[rgba(20,21,15,0.08)] pt-3 text-xs text-[#6E7066]">
        <span>Term 2 · Week 6 of 12</span>
        <div className="flex items-center gap-1 font-medium text-[#14150F] hover:underline cursor-pointer">
          <span>View curriculum</span>
          <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </BentoCard>
  );
}
