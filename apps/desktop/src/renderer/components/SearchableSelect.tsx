import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { listOptionClass, useListKeyboard } from '@/lib/use-list-keyboard';
import { useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select option…',
  searchPlaceholder = 'Search options…',
  emptyText = 'No options found.',
  className,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useDismiss(open, [triggerRef, menuRef], close);

  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return;
    }
    function positionMenu() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Prefer opening downwards, otherwise upwards if space below is small (<220px)
      const openUpwards = spaceBelow < 220 && spaceAbove > spaceBelow;

      setPopoverStyle({
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, 240),
        top: openUpwards ? undefined : rect.bottom + 6,
        bottom: openUpwards ? window.innerHeight - rect.top + 6 : undefined,
        maxHeight: openUpwards ? Math.max(160, rect.top - 12) : Math.max(160, spaceBelow - 12),
        zIndex: 9999,
      });
    }
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = options.filter((opt) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      opt.label.toLowerCase().includes(q) ||
      (opt.sublabel && opt.sublabel.toLowerCase().includes(q)) ||
      opt.value.toLowerCase().includes(q)
    );
  });

  const selectedIndex = Math.max(
    0,
    filteredOptions.findIndex((opt) => opt.value === value),
  );
  const { cursor, setCursor, onKeyDown } = useListKeyboard({
    open,
    count: filteredOptions.length,
    initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
    resetKey: query,
    enabled: (index) => !filteredOptions[index]?.disabled,
    onSelect: (index) => {
      const opt = filteredOptions[index];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      close();
    },
    onClose: close,
  });

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-left text-sm transition-colors',
          'hover:bg-foreground/[0.04] focus-visible:border-border-strong',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">
          {selectedOption ? selectedOption.label : <span className="text-muted">{placeholder}</span>}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 flex-none text-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && popoverStyle
        ? createPortal(
            <div
              ref={menuRef}
              style={popoverStyle}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background text-sm shadow-lg"
            >
              {/* Search Header */}
              <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
                <Search className="h-3.5 w-3.5 flex-none text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(event) => {
                    onKeyDown(event);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded-full text-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>

              {/* Options List */}
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {filteredOptions.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted">{emptyText}</div>
                ) : (
                  filteredOptions.map((opt, index) => {
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={opt.disabled}
                        data-active={index === cursor ? 'true' : undefined}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => {
                          onChange(opt.value);
                          close();
                        }}
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                          listOptionClass(index === cursor, isSelected),
                          isSelected && 'font-medium text-foreground',
                          !isSelected && 'text-foreground/80',
                          opt.disabled && 'cursor-not-allowed opacity-40',
                        )}
                      >
                        <div className="min-w-0 flex-1 truncate">
                          <div>{opt.label}</div>
                          {opt.sublabel ? (
                            <div className="truncate font-mono text-[11px] text-muted">
                              {opt.sublabel}
                            </div>
                          ) : null}
                        </div>
                        {isSelected ? <Check className="h-4 w-4 flex-none text-accent-700" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
