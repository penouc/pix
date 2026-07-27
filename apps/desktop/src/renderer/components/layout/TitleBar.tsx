import type { CSSProperties, ReactNode } from 'react';

import { PiMark } from '@/components/ui/pi-mark';

const drag = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * Compact window chrome: macOS traffic lights sit in the left inset (`hiddenInset`),
 * PiX centred, optional right slot. Kept shorter than the original 44px bar.
 */
export function TitleBar({ right }: { right?: ReactNode }) {
  return (
    <div className="flex h-9 flex-none items-center gap-2 bg-surface px-3" style={drag}>
      <div className="w-[70px] flex-none" />
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 text-[11.5px] tracking-[0.02em] text-muted">
        <PiMark size={16} />
        <span>PiX</span>
      </div>
      <div className="flex flex-1 justify-end gap-2" style={noDrag}>
        {right}
      </div>
    </div>
  );
}
