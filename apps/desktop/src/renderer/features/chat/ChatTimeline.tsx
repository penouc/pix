import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FilePlus2,
  FolderSearch,
  Pencil,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import type { HistoryMessage } from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';

import { Markdown } from '@/features/chat/Markdown';
import { ThinkingStreamRow } from '@/features/chat/ThinkingStream';
import { cn } from '@/lib/utils';
import type { ToolCallCard } from '@/stores/agent-stream-store';

const toolIcons: Record<string, ReactNode> = {
  read: <BookOpen className="h-3 w-3" />,
  edit: <Pencil className="h-3 w-3" />,
  write: <FilePlus2 className="h-3 w-3" />,
  bash: <Terminal className="h-3 w-3" />,
  grep: <Search className="h-3 w-3" />,
  find: <FolderSearch className="h-3 w-3" />,
  ls: <FolderSearch className="h-3 w-3" />,
};

/** User bubble — same chrome as the live PiX chat thread. */
export function UserMessageBubble({ content }: { content: string }) {
  return (
    <div className="group/message flex max-w-[78%] self-end flex-col items-end gap-1.5">
      {content ? (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-[22px_22px_6px_22px] bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed shadow-[var(--shadow-sm)] whitespace-pre-wrap">
          {content}
        </div>
      ) : null}
      {content ? <MessageCopyButton content={content} /> : null}
    </div>
  );
}

export function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('[chat] copy failed', error);
    }
  }

  return (
    <button
      type="button"
      className="message-copy-button"
      onClick={() => void copyMessage()}
      title={copied ? 'Copied' : 'Copy message'}
      aria-label={copied ? 'Message copied' : 'Copy message'}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function AssistantMessage({ content, streaming }: { content: string; streaming: boolean }) {
  const renderedRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'markdown' | 'formatted' | null>(null);

  function showCopied(format: 'markdown' | 'formatted') {
    setCopied(format);
    window.setTimeout(() => setCopied((current) => (current === format ? null : current)), 1600);
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(content);
      showCopied('markdown');
    } catch (error) {
      console.error('[chat] copy markdown failed', error);
    }
  }

  async function copyFormatted() {
    const rendered = renderedRef.current;
    if (!rendered) return;

    const copy = rendered.cloneNode(true) as HTMLDivElement;
    copy
      .querySelectorAll('button, [data-streamdown="code-block-actions"]')
      .forEach((control) => control.remove());
    const html = copy.innerHTML;
    const plainText = rendered.innerText;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      showCopied('formatted');
    } catch (error) {
      console.error('[chat] copy formatted output failed', error);
    }
  }

  return (
    <div className="group/assistant flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-x-hidden py-1">
      <div ref={renderedRef} className="min-w-0 max-w-full">
        <Markdown streaming={streaming}>{content}</Markdown>
      </div>
      {!streaming && content ? (
        <div className="assistant-message-actions" aria-label="Copy response">
          <button
            type="button"
            className="message-icon-button"
            onClick={() => void copyMarkdown()}
            title={copied === 'markdown' ? 'Markdown copied' : 'Copy original Markdown'}
            aria-label={copied === 'markdown' ? 'Markdown copied' : 'Copy original Markdown'}
          >
            {copied === 'markdown' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="message-icon-button"
            onClick={() => void copyFormatted()}
            title={copied === 'formatted' ? 'Formatted response copied' : 'Copy formatted response'}
            aria-label={
              copied === 'formatted' ? 'Formatted response copied' : 'Copy formatted response'
            }
          >
            {copied === 'formatted' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ToolCard({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolCallCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ok = tool.status === 'completed';
  const failed = tool.status === 'failed';
  const runningNow = tool.status === 'running';
  const isBash =
    tool.toolName.toLowerCase() === 'bash' ||
    tool.toolName.toLowerCase() === 'exec' ||
    tool.toolName.toLowerCase() === 'terminal';

  const icon = toolIcons[tool.toolName.toLowerCase()] ?? <Wrench className="h-3 w-3" />;
  const canExpand = Boolean(tool.inputSummary || tool.outputSummary || runningNow);

  const rawSummary = tool.inputSummary.replace(new RegExp(`^${tool.toolName}:\\s*`, 'i'), '');
  let bashCommand = rawSummary;
  if (isBash) {
    try {
      const parsed = JSON.parse(rawSummary);
      if (parsed && typeof parsed === 'object' && typeof parsed.command === 'string') {
        bashCommand = parsed.command;
      }
    } catch {
      // Keep raw string if not JSON
    }
  }

  return (
    <div className="my-0.5 flex w-full min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-0.5 py-1 text-left transition-colors',
          canExpand ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent/10 text-accent-700',
            ok && 'bg-accent-2/10 text-accent-2',
            failed && 'bg-danger/10 text-danger',
            runningNow && 'animate-[pi-think-pulse_1.8s_ease-in-out_infinite]',
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            'flex-none text-[12px] font-semibold tracking-[0.01em] text-muted',
            runningNow && 'think-label-shimmer',
          )}
        >
          {tool.toolName}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-snug text-muted">
          {isBash ? `$ ${bashCommand}` : rawSummary || tool.inputSummary}
        </span>
        {canExpand ? (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 flex-none text-muted transition-transform',
              expanded && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {expanded ? (
        <div className="max-h-72 overflow-y-auto py-1 pl-7 font-mono text-[11.5px] leading-relaxed">
          {isBash ? (
            <>
              <div className="flex items-start gap-2 font-semibold text-foreground/80">
                <span className="select-none text-accent-700">$</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{bashCommand}</span>
              </div>
              {tool.outputSummary ? (
                <pre className="output-pre mt-2 w-full max-w-full overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.outputSummary}
                </pre>
              ) : runningNow ? (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                  <span
                    className="size-1.5 rounded-full bg-accent"
                    style={{ animation: 'pi-pulse 1.2s ease-in-out infinite' }}
                  />
                  <span>Executing command…</span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {tool.inputSummary ? (
                <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.inputSummary}
                </pre>
              ) : null}
              {tool.outputSummary ? (
                <pre className="output-pre w-full max-w-full whitespace-pre-wrap font-mono text-[11.5px] text-muted">
                  {tool.outputSummary}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * History transcript using the same message chrome as ChatPanel.
 * Live follow-ups append below via ACP; this block stays archival.
 */
export function HistoryChatTranscript({
  messages,
  agent,
  mode = 'readonly',
}: {
  messages: HistoryMessage[];
  agent: string;
  mode?: 'readonly' | 'live';
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!messages.length) {
    return <div className="text-[12.5px] text-muted">No messages in this session.</div>;
  }

  const agentLabel =
    HISTORY_AGENT_DISPLAY[agent as keyof typeof HISTORY_AGENT_DISPLAY] ?? agent;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-3">
      <div className="self-center rounded-full bg-foreground/[0.05] px-3 py-1 text-center text-[11px] leading-snug text-muted">
        {mode === 'live' ? `Archive · ${agentLabel}` : `Read-only · ${agentLabel}`}
      </div>
      {messages.map((m) => {
        const key = String(m.seq);
        if (m.kind === 'thinking') {
          const body = (m.thinking || m.text).trim();
          return (
            <ThinkingStreamRow
              key={key}
              content={body}
              streaming={false}
              expanded={Boolean(expanded[key])}
              onToggle={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
            />
          );
        }
        if (m.kind === 'tool') {
          const tool: ToolCallCard = {
            id: key,
            toolName: m.toolName ?? 'tool',
            inputSummary: m.text,
            outputSummary: undefined,
            status: 'completed',
            order: m.seq,
          };
          return (
            <ToolCard
              key={key}
              tool={tool}
              expanded={Boolean(expanded[key])}
              onToggle={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
            />
          );
        }
        if (m.role === 'user') {
          return <UserMessageBubble key={key} content={m.text} />;
        }
        if (m.role === 'system') {
          return (
            <div
              key={key}
              className="self-center rounded-full bg-foreground/[0.05] px-3 py-1 text-center text-[11px] leading-snug text-muted"
            >
              {m.text}
            </div>
          );
        }
        return <AssistantMessage key={key} content={m.text} streaming={false} />;
      })}
    </div>
  );
}
