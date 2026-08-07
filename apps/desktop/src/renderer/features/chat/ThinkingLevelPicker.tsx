import { Brain, Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ThinkingLevel } from '@pi-desktop/protocol';

import { modelKey } from '@/features/models/model-key';
import { useOfferedModels } from '@/features/models/use-offered-models';
import { invoke } from '@/lib/ipc';
import { listOptionClass, useListKeyboard } from '@/lib/use-list-keyboard';
import { useAnchorAbove, useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

const ALL_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const LABELS: Record<ThinkingLevel, { word: string; detail: string }> = {
  off: { word: 'Off', detail: 'No extended reasoning' },
  minimal: { word: 'Minimal', detail: 'Very brief reasoning (~1k tokens)' },
  low: { word: 'Low', detail: 'Light reasoning (~2k tokens)' },
  medium: { word: 'Medium', detail: 'Moderate reasoning (~8k tokens)' },
  high: { word: 'High', detail: 'Deep reasoning (~16k tokens)' },
  xhigh: { word: 'Extra', detail: 'Extra-high reasoning (~32k tokens)' },
  max: { word: 'Max', detail: 'Maximum reasoning' },
};

/**
 * Reasoning depth for models that support extended thinking.
 *
 * Pi exposes discrete levels (off → max); other desktop agents surface the same
 * choice beside the model picker. Without it, reasoning models always run at
 * whatever default the SDK picked.
 */
export function ThinkingLevelPicker({ disabled }: { disabled?: boolean }) {
  const session = useWorkspaceStore((s) => s.session);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const selectedThinkingLevel = useWorkspaceStore((s) => s.selectedThinkingLevel);
  const setSelectedThinkingLevel = useWorkspaceStore((s) => s.setSelectedThinkingLevel);
  const { models } = useOfferedModels();
  const queryClient = useQueryClient();

  const live = useQuery({
    queryKey: ['agent.getThinkingLevel', session?.id],
    enabled: Boolean(session?.id),
    queryFn: () =>
      invoke<{ level: ThinkingLevel; available: ThinkingLevel[]; supportsThinking: boolean }>({
        method: 'agent.getThinkingLevel',
        params: { sessionId: session!.id },
      }),
  });

  const setLevel = useMutation({
    mutationFn: (level: ThinkingLevel) =>
      invoke({
        method: 'agent.setThinkingLevel',
        params: { sessionId: session!.id, level },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['agent.getThinkingLevel', session?.id] }),
  });

  const activeModel = models.find((model) => modelKey(model) === selectedModel);
  const supportsThinking = session
    ? (live.data?.supportsThinking ?? false)
    : Boolean(activeModel?.reasoning);
  const level = session ? (live.data?.level ?? 'medium') : selectedThinkingLevel;
  const options = useMemo(() => {
    const available = session ? (live.data?.available ?? []) : ALL_LEVELS;
    return available.filter((entry) => ALL_LEVELS.includes(entry));
  }, [session, live.data?.available]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [rootRef, menuRef], close);
  const anchor = useAnchorAbove(open, rootRef, 'left');

  function choose(next: ThinkingLevel) {
    setOpen(false);
    if (session) {
      setLevel.mutate(next);
    } else {
      setSelectedThinkingLevel(next);
    }
  }

  const activeIndex = Math.max(0, options.indexOf(level));
  const { cursor, setCursor } = useListKeyboard({
    open,
    count: options.length,
    initialIndex: activeIndex,
    resetKey: options.join(','),
    window: true,
    onSelect: (index) => {
      const next = options[index];
      if (next) choose(next);
    },
    onClose: close,
  });

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor]);

  if (!supportsThinking || !options.length) return null;

  const active = LABELS[level] ?? LABELS.medium;

  return (
    <div ref={rootRef} className="relative inline-flex flex-none">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || setLevel.isPending}
        onClick={() => setOpen((value) => !value)}
        title={`Thinking depth: ${active.word} — ${active.detail}`}
        className="flex h-[26px] max-w-[112px] cursor-pointer items-center gap-1 rounded-full border-0 bg-foreground/[0.06] pr-1.5 pl-2 text-[11.5px] hover:bg-foreground/[0.1]"
      >
        <Brain className="h-3.5 w-3.5 flex-none text-muted" />
        <span className="min-w-0 truncate">{active.word}</span>
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
              {options.map((entry, index) => {
                const meta = LABELS[entry];
                return (
                  <button
                    key={entry}
                    type="button"
                    role="option"
                    data-active={index === cursor ? 'true' : undefined}
                    aria-selected={entry === level}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => choose(entry)}
                    className={cn(
                      'flex w-full cursor-pointer items-start gap-2.5 border-0 bg-transparent px-3 py-2 text-left',
                      listOptionClass(index === cursor, entry === level),
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold">{meta.word}</span>
                      <span className="block text-[11px] leading-snug text-muted">
                        {meta.detail}
                      </span>
                    </span>
                    {entry === level ? (
                      <Check className="mt-[2px] h-3.5 w-3.5 flex-none text-accent" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
