import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's standard class-merge helper — same implementation as
 * packages/ui/src/cn.ts; kept local here (rather than depending on
 * @lab/ui) because every generated shadcn component imports from
 * '@/lib/utils' by convention. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
