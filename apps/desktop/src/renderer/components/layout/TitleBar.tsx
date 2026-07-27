import type { CSSProperties, ReactNode } from 'react';

const drag = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * The design's 44px chrome bar: window controls at the left, app name centred,
 * the active model at the right.
 *
 * The mockup draws its own traffic lights because it renders in a browser —
 * here they are the real macOS controls (`titleBarStyle: 'hiddenInset'`), so
 * this reserves their inset instead of painting fakes.
 */
export function TitleBar({ right }: { right?: ReactNode }) {
  return (
    <div className="flex h-11 flex-none items-center gap-3 bg-surface px-4" style={drag}>
      <div className="w-[78px] flex-none" />
      <div className="flex-1" />
      <div className="text-[12px] tracking-[0.02em] text-muted">PiX</div>
      <div className="flex flex-1 justify-end gap-2" style={noDrag}>
        {right}
      </div>
    </div>
  );
}
