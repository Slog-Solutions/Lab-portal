import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fieldClass } from './input';

/**
 * A native <select> styled to match <Input>. Use it for plain form fields
 * (keyboard/typeahead and form semantics for free); reach for the Radix
 * `ui/select` only when options need custom rendering.
 *
 * `className` sizes the wrapper (e.g. `w-full`, `w-56`); the select fills it.
 * `compact` is the 32px height for toolbar rows next to `size="sm"` buttons.
 */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }
>(({ className, children, compact = false, ...props }, ref) => (
  <div className={cn('relative', className)}>
    <select
      ref={ref}
      className={cn(fieldClass, 'cursor-pointer appearance-none truncate', compact ? 'h-8 pl-3 pr-8 text-xs' : 'h-10 pr-9')}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', compact ? 'right-2.5 h-3.5 w-3.5' : 'right-3 h-4 w-4')}
      aria-hidden
    />
  </div>
));
NativeSelect.displayName = 'NativeSelect';
