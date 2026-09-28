import * as React from 'react';
import { BentoCard } from './BentoCard';
import { cn } from '@/lib/utils';
import { TrendingUp } from 'lucide-react';

export interface DarkStatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  periodLabel?: string;
  periodOptions?: string[];
  onPeriodChange?: (period: string) => void;
  sparklineData?: number[];
  className?: string;
}

export function DarkStatCard({
  label,
  value,
  delta = '+14%',
  deltaPositive = true,
  periodLabel = 'This week',
  periodOptions,
  onPeriodChange,
  sparklineData = [24, 38, 30, 48, 55, 62, 58, 72, 85, 92],
  className,
}: DarkStatCardProps) {
  // Generate smooth SVG sparkline path
  const minVal = Math.min(...sparklineData);
  const maxVal = Math.max(...sparklineData);
  const range = maxVal - minVal || 1;
  const width = 280;
  const height = 54;
  const points = sparklineData.map((d, i) => {
    const x = (i / (sparklineData.length - 1)) * width;
    const y = height - ((d - minVal) / range) * (height - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = points.length > 0 ? `M ${points.join(' L ')}` : '';
  const areaD = points.length > 0 ? `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z` : '';

  return (
    <BentoCard variant="dark" className={cn('flex flex-col justify-between overflow-hidden', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#9A9C97]">{label}</span>
        {periodOptions && periodOptions.length > 0 ? (
          <select
            value={periodLabel}
            onChange={(e) => onPeriodChange?.(e.target.value)}
            className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-[#F5F5F0] outline-none hover:bg-white/15 cursor-pointer"
          >
            {periodOptions.map((opt) => (
              <option key={opt} value={opt} className="bg-[#17181A] text-white">
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-[#F5F5F0]">
            {periodLabel}
          </span>
        )}
      </div>

      <div className="my-3 flex items-center justify-between gap-4">
        <div>
          <span className="text-hero-num text-[#F5F5F0]">{value}</span>
        </div>

        {delta && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#F5F5F0]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#D7F83C]" />
            <TrendingUp className="h-3 w-3 text-[#D7F83C]" />
            <span>{delta}</span>
          </div>
        )}
      </div>

      {/* Sparkline chart along bottom */}
      <div className="-mx-6 -mb-6 mt-2 pt-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-14 w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D7F83C" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#D7F83C" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#sparklineGrad)" />
          <path
            d={pathD}
            fill="none"
            stroke="#D7F83C"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </BentoCard>
  );
}
