import { useCallback, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * Vertical split handle between two flex columns. Uses pointer capture so drags
 * stay smooth even when the cursor leaves the narrow hit target.
 */
export function PanelResizer({
  side,
  value,
  min,
  max,
  onChange,
}: {
  /** Panel being resized sits to the left or right of this handle. */
  side: 'left' | 'right';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);

  const clamp = useCallback(
    (next: number) => Math.round(Math.min(max, Math.max(min, next))),
    [min, max],
  );

  const finish = useCallback((target: HTMLDivElement, pointerId: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* capture already released */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize"
      style={noDrag}
      className={cn(
        'relative z-10 flex-none touch-none select-none',
        'w-2 cursor-col-resize bg-transparent',
        'before:absolute before:inset-y-0 before:-left-2 before:-right-2 before:content-[""]',
        'hover:bg-accent/35 focus-visible:bg-accent/35',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        startX.current = event.clientX;
        startValue.current = value;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const delta = event.clientX - startX.current;
        const next =
          side === 'left' ? startValue.current + delta : startValue.current - delta;
        onChange(clamp(next));
      }}
      onPointerUp={(event) => finish(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finish(event.currentTarget, event.pointerId)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -16 : 16;
        const next =
          side === 'left' ? value + delta : value - delta;
        onChange(clamp(next));
      }}
    />
  );
}
