import type * as React from 'react';
import { cn } from '@/lib/utils';
import logoFullUrl from '@/assets/brand/dll-logo-full.png';
import logoMarkUrl from '@/assets/brand/dll-mark.png';
// 512px resize of _source/DL_Logo_small.png (the master is 1254px / 545 KB).
import logoSmallUrl from '@/assets/brand/dll-logo-small.png';

// Imported (not referenced as /brand/...) so Vite fingerprints them and
// resolves them against `base: './'` — a root-absolute path would 404 under
// Electron's app:// scheme. See DESIGN_SYSTEM.md §4.
//
// Intrinsic sizes of the shipped files, passed as width/height so the box is
// reserved before decode and the sidebar/login header don't reflow.
const SOURCES = {
  full: { src: logoFullUrl, width: 480, height: 162 },
  mark: { src: logoMarkUrl, width: 256, height: 256 },
  small: { src: logoSmallUrl, width: 512, height: 512 },
} as const;

export interface BrandLogoProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'width' | 'height'> {
  /**
   * `full` is the wordmark + mark lockup; `mark` is the square "D" only;
   * `small` is the square "D" from DL_Logo_small, used on the login page.
   */
  variant?: keyof typeof SOURCES;
  /**
   * Set when the product name is already rendered as adjacent text, so the
   * logo is decorative and screen readers don't announce it twice.
   */
  decorative?: boolean;
}

export function BrandLogo({ variant = 'full', decorative = false, className, ...props }: BrandLogoProps) {
  const { src, width, height } = SOURCES[variant];
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt={decorative ? '' : 'Digital Language Lab'}
      aria-hidden={decorative || undefined}
      // Both PNGs have transparent backgrounds, so they sit correctly on the
      // cream canvas and on the green chrome without a plate behind them.
      className={cn('block h-auto select-none object-contain', className)}
      draggable={false}
      {...props}
    />
  );
}
