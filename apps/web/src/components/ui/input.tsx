import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one text-field look, shared by Input, Textarea, NativeSelect and the
 * Radix SelectTrigger: rectangular (`rounded-field`), light border, card
 * surface, and a brand-green border on focus. Callers still size it with
 * `h-*` / `w-*` — tailwind-merge lets those override the defaults below.
 */
export const fieldClass =
  'w-full rounded-field border border-input bg-card px-3.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/25 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60 aria-[invalid=true]:border-destructive';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} className={cn('flex h-10 py-2', fieldClass, className)} ref={ref} {...props} />
  ),
);
Input.displayName = 'Input';
