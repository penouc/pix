import type { CSSProperties, ReactNode } from 'react';

import { PiMark } from '@/components/ui/pi-mark';
import { detectOs } from '@/lib/platform';
import { cn } from '@/lib/utils';

const drag = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * Compact window chrome.
 *
 * - macOS: traffic lights sit in the left inset (`hiddenInset`); left slot
 *   (sidebar collapse) starts after that inset.
 * - Windows: Main uses `titleBarStyle: 'hidden'` + `titleBarOverlay`, so this
 *   bar *is* the title bar. Collapse sits flush-left (no orphan row / no
 *   traffic-light spacer); right padding clears the caption buttons via the
 *   Window Controls Overlay env vars.
 */
export function TitleBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const os = detectOs();
  const isMac = os === 'mac';
  const isWindows = os === 'windows';

  return (
    <div
      className={cn(
        'relative flex h-9 flex-none items-center gap-2 bg-surface',
        isMac ? 'px-3' : 'pl-2.5',
      )}
      style={{
        ...drag,
        // Reserve the caption-button strip so brand/actions never sit under it.
        ...(isWindows
          ? {
              paddingRight:
                'max(12px, calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px)))',
            }
          : !isMac
            ? { paddingRight: 12 }
            : {}),
      }}
    >
      {isMac ? <div className="w-[70px] flex-none" aria-hidden /> : null}
      <div
        className={cn('flex items-center', isMac ? 'absolute left-[76px]' : 'flex-none')}
        style={noDrag}
      >
        {left}
      </div>
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
