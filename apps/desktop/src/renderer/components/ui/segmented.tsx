import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered but non-selectable — used where the capability does not exist yet. */
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * The design's pill segmented control: a tinted track, the active option
 * lifted onto the page ground with a small shadow and accent-700 label.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-full bg-foreground/[0.06] p-[3px]',
        size === 'sm' && 'p-[2px]',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            disabled={option.disabled}
            onClick={onChange && !option.disabled ? () => onChange(option.value) : undefined}
            className={cn(
              'cursor-pointer rounded-full border-0 font-semibold transition-colors',
              size === 'sm' ? 'px-2.5 py-[3px] text-[11px]' : 'px-3 py-1 text-[11.5px]',
              active
                ? 'bg-background text-accent-700 shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-foreground/60 hover:text-foreground',
              option.disabled && 'cursor-not-allowed opacity-45 hover:text-foreground/60',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
