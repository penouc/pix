import { Check, ChevronDown, Map, Wrench } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { SessionMode } from '@pi-desktop/protocol';

import { useAnchorAbove, useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';

/**
 * Plan = read-only toolset (explore / propose). Build = full coding tools.
 * Orthogonal to the approval-mode picker (“Ask / Auto / Read-only”).
 *
 * Dropdown (not segmented): mode changes are infrequent, and a single-word
 * trigger frees the composer footer for send-path controls.
 */
const MODES: Array<{
  value: SessionMode;
  word: string;
  detail: string;
  icon: ReactNode;
}> = [
  {
    value: 'plan',
    word: 'Plan',
    detail: 'Read-only tools — explore and propose without writing',
    icon: <Map className="h-3.5 w-3.5" />,
  },
  {
    value: 'build',
    word: 'Build',
    detail: 'Full coding tools — read, edit, write, bash',
    icon: <Wrench className="h-3.5 w-3.5" />,
  },
];

export function SessionModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [rootRef, menuRef], close);
  const anchor = useAnchorAbove(open, rootRef, 'left');

  const active = MODES.find((entry) => entry.value === mode) ?? MODES[1]!;

  return (
    <div ref={rootRef} className="relative inline-flex flex-none">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title={`Session mode: ${active.word} — ${active.detail}`}
        className="flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-foreground/[0.06] pr-2 pl-2.5 text-[12px] hover:bg-foreground/[0.1]"
      >
        <span className="flex-none text-muted">{active.icon}</span>
        <span>{active.word}</span>
        <ChevronDown className="h-3 w-3 flex-none text-muted" />
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={anchor}
              className="z-50 w-[268px] overflow-y-auto rounded-[16px] border border-border bg-background py-1 shadow-[var(--shadow-lg)]"
            >
              {MODES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="option"
                  aria-selected={entry.value === mode}
                  disabled={disabled}
                  onClick={() => {
                    onChange(entry.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2.5 border-0 bg-transparent px-3 py-2 text-left',
                    entry.value === mode ? 'bg-accent-soft' : 'hover:bg-foreground/[0.06]',
                    disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <span className="mt-[2px] flex-none text-muted">{entry.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold">{entry.word}</span>
                    <span className="block text-[11px] leading-snug text-muted">
                      {entry.detail}
                    </span>
                  </span>
                  {entry.value === mode ? (
                    <Check className="mt-[2px] h-3.5 w-3.5 flex-none text-accent" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
