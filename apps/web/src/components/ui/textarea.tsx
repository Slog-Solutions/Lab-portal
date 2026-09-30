import * as React from 'react';
import { cn } from '@/lib/utils';
import { fieldClass } from './input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea className={cn('flex min-h-24 py-2.5 leading-relaxed', fieldClass, className)} ref={ref} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
