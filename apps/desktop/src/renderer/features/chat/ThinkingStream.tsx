import { Brain, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Collapse reasoning to one line and keep the tail visible as tokens stream in. */
export function thinkingPreview(text: string, maxLen = 148): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  if (oneLine.length <= maxLen) return oneLine;
  return `…${oneLine.slice(-(maxLen - 1))}`;
}

/**
 * One-line reasoning stream — the Codex/Cursor pattern: a compact row that shows
 * the latest slice of the chain instead of a tall thinking block.
 */
export function ThinkingStreamRow({
  content,
  streaming,
  expanded,
  onToggle,
}: {
  content: string;
  streaming: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const preview = thinkingPreview(content);
  const hasBody = Boolean(content.trim());

  return (
    <div className="flex max-w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={hasBody ? onToggle : undefined}
        className={cn(
          'flex w-full max-w-full min-w-0 items-center gap-2 rounded-[14px] border border-border/70 bg-foreground/[0.03] px-3 py-2 text-left transition-colors',
          hasBody && 'cursor-pointer hover:bg-foreground/[0.05]',
          !hasBody && 'cursor-default',
        )}
        title={hasBody ? (expanded ? 'Collapse reasoning' : 'Expand reasoning') : 'Thinking'}
      >
        <span
          className={cn(
            'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent/10',
            streaming && 'animate-[pi-think-pulse_1.8s_ease-in-out_infinite]',
          )}
        >
          <Brain className="h-3.5 w-3.5 text-accent-700" />
        </span>

        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex-none text-[12px] font-semibold tracking-[0.01em]',
                streaming ? 'think-label-shimmer' : 'text-muted',
              )}
            >
              {streaming ? 'Thinking' : 'Thought'}
            </span>
            {preview ? (
              <span
                className={cn(
                  'min-w-0 truncate font-mono text-[11.5px] leading-snug',
                  streaming ? 'think-preview-shimmer text-foreground/55' : 'text-muted',
                )}
              >
                {preview}
              </span>
            ) : streaming ? (
              <span className="think-dots flex-none text-[11px] text-muted" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            ) : null}
          </span>
        </span>

        {hasBody ? (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 flex-none text-muted transition-transform',
              expanded && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {expanded && hasBody ? (
        <div
          className="max-h-40 overflow-y-auto rounded-[14px] border border-border/60 bg-foreground/[0.02] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-muted whitespace-pre-wrap"
        >
          {content.trim()}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Placeholder before the first thinking token lands — same shell, shimmer only.
 */
export function ThinkingPlaceholderRow() {
  return <ThinkingStreamRow content="" streaming expanded={false} onToggle={() => undefined} />;
}
