import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors', {
  variants: {
    variant: {
      default: 'border-transparent bg-brand text-brand-ink',
      secondary: 'border-transparent bg-cream text-brand',
      destructive: 'border-transparent bg-destructive text-destructive-foreground',
      outline: 'border-border text-foreground',
      // Status variants route through the status-* tokens rather than the
      // stock emerald/amber palette, so a badge and a status dot elsewhere on
      // the same screen are guaranteed to be the same colour.
      success: 'border-transparent bg-status-online text-white',
      warning: 'border-transparent bg-status-pending text-white',
      info: 'border-transparent bg-status-info text-white',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

// <span>, not <div> — a badge is an inline chip, and several real call
// sites nest it inside a <p> (BatchDetailPage's "Batch key: ... ·
// <Badge>"), which HTML forbids for a <div> inside a <p> and React
// flags as a real hydration-mismatch warning (caught live, Playwright-
// driven, not by typechecking — a <div> descendant of a block element
// it happened to sit inside elsewhere never surfaced it).
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
