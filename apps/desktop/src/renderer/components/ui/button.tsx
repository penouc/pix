import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Organic `.btn` — the design system owns the shape (pill radius, body-face
 * semibold, themed hover/active/focus states) in globals.css; these variants
 * only pick the fill and the interface height.
 *
 * The system carries no red role: destructive actions read as deep terracotta
 * on a tinted outline, matching the design's Deny / Revert all buttons.
 */
const buttonVariants = cva('btn', {
  variants: {
    variant: {
      default: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      quiet: 'btn-quiet',
      danger: 'btn-secondary text-accent-800 border-accent/35 hover:bg-accent/10',
    },
    size: {
      default: 'h-8',
      sm: 'h-[26px] px-3 text-xs',
      lg: 'h-[34px]',
      icon: 'btn-icon',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
