import mascotUrl from '@/assets/pix-mascot.png';
import { cn } from '@/lib/utils';

/** PiX mascot — the product avatar in thread and chrome. */
export function PiMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={mascotUrl}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('object-contain', className)}
    />
  );
}

/**
 * Round frame for the mascot. `markSize` sets the image edge length inside the
 * circle — the design pairs a 17px mark with its 36px hero circle and a 13px
 * mark with the 24px thread avatar.
 */
export function PiAvatar({
  bobbing = false,
  markSize = 16,
  className,
}: {
  bobbing?: boolean;
  markSize?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 flex-none place-items-center rounded-full bg-accent-2-100 p-0.5',
        className,
      )}
      style={bobbing ? { animation: 'pi-bob 1.4s ease-in-out infinite' } : undefined}
    >
      <PiMark size={markSize} />
    </span>
  );
}
