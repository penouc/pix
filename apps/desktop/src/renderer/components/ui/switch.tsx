import { cn } from '@/lib/utils';

/** The design's 34×20 pill switch: sage when on, neutral track when off. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-5 w-[34px] flex-none rounded-full border-0 p-0.5 transition-colors',
        checked ? 'justify-end bg-accent-2' : 'justify-start bg-neutral-300',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
      )}
    >
      <span className="block h-4 w-4 rounded-full bg-white shadow-[var(--shadow-sm)]" />
    </button>
  );
}
