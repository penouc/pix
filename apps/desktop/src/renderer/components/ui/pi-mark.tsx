import { cn } from '@/lib/utils';

/** The Pi glyph — two slanted strokes, as drawn in the design file. */
export function PiMark({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 11) / 13)}
      viewBox="0 0 160 130"
      fill="none"
      stroke="currentColor"
      strokeWidth={9}
      aria-hidden="true"
      className={className}
    >
      <path d="M14 22 L70 22 L56 108 L0 108 Z" />
      <path d="M86 22 L120 22 L106 108 L72 108 Z" />
    </svg>
  );
}

/**
 * Round accent avatar the assistant's turns are anchored to. `markSize` scales
 * the glyph with the circle — the design pairs a 17px mark with its 36px hero
 * circle and a 13px mark with the 24px thread avatar.
 */
export function PiAvatar({
  bobbing = false,
  markSize = 13,
  className,
}: {
  bobbing?: boolean;
  markSize?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 flex-none place-items-center rounded-full bg-accent text-white',
        className,
      )}
      style={bobbing ? { animation: 'pi-bob 1.4s ease-in-out infinite' } : undefined}
    >
      <PiMark size={markSize} />
    </span>
  );
}
