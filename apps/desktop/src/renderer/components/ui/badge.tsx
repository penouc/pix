import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'accent' | 'accent-2' | 'neutral' | 'outline' | 'warning';

const toneClass: Record<BadgeTone, string> = {
  accent: 'tag-accent',
  'accent-2': 'tag-accent-2',
  neutral: 'tag-neutral',
  outline: 'tag-outline',
  warning: 'tag-warning',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Organic `.tag` — small labels tinted from the ramps. */
export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return <span className={cn('tag', toneClass[tone], className)} {...props} />;
}
