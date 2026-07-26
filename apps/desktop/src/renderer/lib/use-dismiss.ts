import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Close a popover on an outside click or Escape.
 *
 * Takes every element that counts as "inside", because a portalled menu is not a
 * DOM descendant of its trigger — checking only the trigger would close the menu
 * on the first click *in* it.
 *
 * `pointerdown` rather than `click`: a click fires after focus has already moved,
 * which lets a menu swallow the first interaction with whatever is behind it.
 */
export function useDismiss(
  open: boolean,
  refs: Array<RefObject<HTMLElement | null>>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function inside(target: Node): boolean {
      return refs.some((ref) => ref.current?.contains(target));
    }
    function onPointerDown(event: PointerEvent) {
      if (!inside(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Stops the Escape also reaching whatever else listens for it — one key
      // should do one thing.
      event.stopPropagation();
      close();
    }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, ...refs]);
}

/**
 * Fixed-position style that puts a menu directly above its trigger.
 *
 * Menus in the composer have to be portalled: the composer is a rounded card with
 * `overflow-hidden`, so anything opening upwards inside it gets cropped — which
 * is exactly what happened, and the top item of a three-item menu was invisible.
 * Portalling escapes the clip, and that in turn means position must be measured
 * from the trigger rather than inherited from a positioned ancestor.
 */
export function useAnchorAbove(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  align: 'left' | 'right' = 'left',
  gap = 6,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  // Layout effect so the menu is never painted at a stale position first.
  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    function measure() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        // Anchored by its bottom edge, so the menu grows upwards.
        bottom: Math.max(gap, window.innerHeight - rect.top + gap),
        ...(align === 'right'
          ? { right: Math.max(gap, window.innerWidth - rect.right) }
          : { left: Math.max(gap, rect.left) }),
        maxHeight: Math.max(160, rect.top - gap * 2),
      });
    }
    measure();
    // The window can resize (and the dock can be dragged) while a menu is open.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, triggerRef, align, gap]);

  return style;
}
