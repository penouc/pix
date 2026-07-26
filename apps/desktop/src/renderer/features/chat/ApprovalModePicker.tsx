import { Check, ChevronDown, Lock, ShieldCheck, Zap } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { ApprovalMode } from '@pi-desktop/protocol';

import { useAnchorAbove, useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';

/**
 * The three approval modes, each with a one-word label and what it actually does.
 *
 * The descriptions are the same strings the composer used to print beside the
 * control, and they match PolicyEngine rather than the labels' implications —
 * which is the whole reason they are kept. "Auto" alone would suggest everything
 * runs freely; bash still stops, and the menu has to say so.
 */
const MODES: Array<{
  value: ApprovalMode;
  word: string;
  detail: string;
  icon: ReactNode;
}> = [
  {
    value: 'ask',
    word: 'Ask',
    detail: 'writes + bash need approval',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  {
    value: 'auto-reads',
    word: 'Auto',
    detail: 'writes run freely, bash asks',
    icon: <Zap className="h-3.5 w-3.5" />,
  },
  {
    value: 'read-only',
    word: 'Read-only',
    detail: 'nothing is written',
    icon: <Lock className="h-3.5 w-3.5" />,
  },
];

/**
 * Approval policy as a dropdown rather than three always-visible segments.
 *
 * It was a segmented control with all three labels spelled out, which took most
 * of the composer's footer for something set once and then left alone. The chosen
 * mode is a single word here; the behaviour it implies lives in the menu and in
 * the trigger's tooltip, so compactness costs no honesty.
 */
export function ApprovalModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
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
        // The full behaviour without opening anything.
        title={`Approval policy: ${active.word} — ${active.detail}`}
        className="flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-foreground/[0.06] pr-2 pl-2.5 text-[12px] hover:bg-foreground/[0.1]"
      >
        <span className="flex-none text-muted">{active.icon}</span>
        <span>{active.word}</span>
        <ChevronDown className="h-3 w-3 flex-none text-muted" />
      </button>

      {open && anchor
        ? createPortal(
            // Portalled: the composer card clips its overflow, so a menu opening
            // upwards inside it loses its top rows.
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
                  onClick={() => {
                    onChange(entry.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2.5 border-0 bg-transparent px-3 py-2 text-left',
                    entry.value === mode ? 'bg-accent-soft' : 'hover:bg-foreground/[0.06]',
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
