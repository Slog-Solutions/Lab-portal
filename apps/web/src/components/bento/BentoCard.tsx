import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'light' | 'dark';
}

export const BentoCard = React.forwardRef<HTMLDivElement, BentoCardProps>(
  ({ className, variant = 'light', children, ...props }, ref) => {
    const isDark = variant === 'dark';
    return (
      <div
        ref={ref}
        className={cn(
          'relative rounded-[28px] p-6 transition-all duration-200',
          isDark
            ? 'border border-[rgba(245,245,240,0.12)] bg-[#17181A] text-[#F5F5F0]'
            : 'border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] text-[#14150F]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

BentoCard.displayName = 'BentoCard';
