import { useCallback, useEffect, useState } from 'react';

type KeyEventLike = {
  key: string;
  preventDefault: () => void;
  stopPropagation?: () => void;
};

/**
 * ArrowUp / ArrowDown / Enter navigation for option lists (dropdowns, suggestion menus).
 *
 * Returns a `cursor` index to highlight and a `onKeyDown` handler. For menus without
 * a focused search field, pass `window: true` so keys are captured while open.
 */
export function useListKeyboard({
  open,
  count,
  onSelect,
  onClose,
  enabled,
  resetKey,
  initialIndex = 0,
  window: attachWindow = false,
}: {
  open: boolean;
  count: number;
  onSelect: (index: number) => void;
  onClose?: () => void;
  /** Return false for disabled rows (skipped by ↑↓ / Enter). Default: all enabled. */
  enabled?: (index: number) => boolean;
  /** When this value changes, cursor resets (e.g. filter query). */
  resetKey?: unknown;
  initialIndex?: number;
  /** Listen on window (capture) while open — for menus without a focused input. */
  window?: boolean;
}): {
  cursor: number;
  setCursor: (index: number) => void;
  onKeyDown: (event: KeyEventLike) => boolean;
} {
  const [cursor, setCursor] = useState(initialIndex);

  const isEnabled = useCallback(
    (index: number) => (enabled ? enabled(index) : true),
    [enabled],
  );

  const clampToEnabled = useCallback(
    (from: number, direction: 1 | -1): number => {
      if (count <= 0) return 0;
      let next = from;
      for (let step = 0; step < count; step += 1) {
        next = (next + direction + count) % count;
        if (isEnabled(next)) return next;
      }
      return Math.max(0, Math.min(from, count - 1));
    },
    [count, isEnabled],
  );

  useEffect(() => {
    if (!open) return;
    const start =
      count > 0 && isEnabled(initialIndex)
        ? initialIndex
        : count > 0
          ? clampToEnabled(initialIndex - 1, 1)
          : 0;
    setCursor(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey intentionally drives reset
  }, [open, resetKey, count]);

  useEffect(() => {
    if (!open || count <= 0) return;
    setCursor((value) => Math.min(value, count - 1));
  }, [open, count]);

  const onKeyDown = useCallback(
    (event: KeyEventLike): boolean => {
      if (!open || count <= 0) return false;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation?.();
        setCursor((value) => clampToEnabled(value, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation?.();
        setCursor((value) => clampToEnabled(value, -1));
        return true;
      }
      if (event.key === 'Enter') {
        if (!isEnabled(cursor)) return false;
        event.preventDefault();
        event.stopPropagation?.();
        onSelect(cursor);
        return true;
      }
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        event.stopPropagation?.();
        onClose();
        return true;
      }
      return false;
    },
    [open, count, cursor, clampToEnabled, isEnabled, onSelect, onClose],
  );

  useEffect(() => {
    if (!attachWindow || !open) return;
    function handle(event: KeyboardEvent) {
      onKeyDown(event);
    }
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [attachWindow, open, onKeyDown]);

  return { cursor, setCursor, onKeyDown };
}

/** Shared highlight classes for listbox / suggestion rows. */
export function listOptionClass(active: boolean, selected?: boolean): string {
  if (active) return 'bg-foreground/[0.08]';
  if (selected) return 'bg-accent-soft';
  return 'hover:bg-foreground/[0.06]';
}
