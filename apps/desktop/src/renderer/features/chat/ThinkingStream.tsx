import { Brain, ChevronDown } from 'lucide-react';

import { Markdown } from '@/features/chat/Markdown';
import { cn } from '@/lib/utils';

/** Collapse reasoning to one line and keep the tail visible as tokens stream in. */
function thinkingPreview(text: string, maxLen = 148): string {
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-1 my-0.5">
      <button
        type="button"
        onClick={hasBody ? onToggle : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 py-1 px-0.5 text-left transition-colors',
          hasBody && 'cursor-pointer hover:opacity-80',
          !hasBody && 'cursor-default',
        )}
        title={hasBody ? (expanded ? 'Collapse reasoning' : 'Expand reasoning') : 'Thinking'}
      >
        <span
          className={cn(
            'flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent/10',
            streaming && 'animate-[pi-think-pulse_1.8s_ease-in-out_infinite]',
          )}
        >
          <Brain className="h-3 w-3 text-accent-700" />
        </span>

        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex flex-none items-baseline text-[12px] font-semibold tracking-[0.01em]">
              <span className={streaming ? 'think-label-shimmer' : 'text-muted'}>
                {streaming ? 'Thinking' : 'Thought'}
              </span>
              {streaming ? (
                <span className="think-ellipsis text-muted" aria-hidden>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              ) : null}
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
        <div className="max-h-60 overflow-y-auto pl-3 my-1 border-l-2 border-accent/25">
          <Markdown streaming={streaming} className="pi-md-think">
            {content.trim()}
          </Markdown>
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
