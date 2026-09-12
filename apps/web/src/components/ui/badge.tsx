import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      destructive: 'border-transparent bg-destructive text-destructive-foreground',
      outline: 'border-border text-foreground',
      success: 'border-transparent bg-emerald-600 text-white',
      warning: 'border-transparent bg-amber-600 text-white',
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
