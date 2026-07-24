import { LoaderCircle, Square, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { RunRef } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function ChatPanel() {
  const session = useWorkspaceStore((s) => s.session);
  const messages = useAgentStreamStore((s) => s.messages);
  const tools = useAgentStreamStore((s) => s.tools);
  const status = useAgentStreamStore((s) => s.status);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const usage = useAgentStreamStore((s) => s.usage);
  const error = useAgentStreamStore((s) => s.error);
  const appendUserMessage = useAgentStreamStore((s) => s.appendUserMessage);
  const setStopping = useAgentStreamStore((s) => s.setStopping);
  const applyEvent = useAgentStreamStore((s) => s.applyEvent);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.piDesktop) return;
    return window.piDesktop.onAgentEvent((event) => {
      applyEvent(event);
    });
  }, [applyEvent]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, tools, status]);

  const running =
    status === 'running' ||
    status === 'starting' ||
    status === 'waiting_for_approval' ||
    status === 'stopping';

  async function send() {
    if (!session || !draft.trim() || running) return;
    const text = draft.trim();
    setDraft('');
    appendUserMessage(text);
    setSending(true);
    try {
      await invoke<RunRef>({
        method: 'agent.sendMessage',
        params: {
          sessionId: session.id,
          text,
          model: { providerId: 'fake', modelId: 'fake-demo' },
        },
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!activeRunId) return;
    setStopping(activeRunId);
    try {
      await invoke({ method: 'agent.abort', params: { runId: activeRunId } });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <div className="text-sm font-medium">Agent Chat</div>
          <div className="text-xs text-muted">
            {session ? `Session ${session.id.slice(0, 8)}…` : 'Create a session to start'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColor(status)}>{status}</Badge>
          {usage?.totalTokens != null ? (
            <Badge>{usage.totalTokens} tokens</Badge>
          ) : null}
        </div>
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
        {!session ? (
          <EmptyState
            title="Open a project and create a session"
            body="M1 uses FakeAgentRuntime so you can verify the full IPC + stream path without model cost."
          />
        ) : messages.length === 0 && tools.length === 0 ? (
          <EmptyState
            title="Send a coding task"
            body="Example: “Rename the primary button label and update tests.” Streaming text and tool cards will appear here."
          />
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-12 rounded-2xl border border-border bg-surface-raised px-4 py-3'
                : 'mr-8 rounded-2xl border border-border bg-background px-4 py-3'
            }
          >
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
              {message.role}
              {message.streaming ? ' · streaming' : ''}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
              {message.content}
              {message.streaming ? <span className="ml-0.5 inline-block animate-pulse">▍</span> : null}
            </pre>
          </article>
        ))}

        {tools.map((tool) => (
          <div
            key={tool.id}
            className="rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-accent">{tool.toolName}</span>
              <span className="text-muted">{tool.status}</span>
            </div>
            <div className="mt-1 text-muted">{tool.inputSummary}</div>
            {tool.outputSummary ? (
              <div className="mt-1 text-foreground/80">{tool.outputSummary}</div>
            ) : null}
          </div>
        ))}

        {error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <footer className="border-t border-border p-4">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-raised p-2">
          <textarea
            className="max-h-40 min-h-[72px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted"
            placeholder={session ? 'Describe a coding task…' : 'Create a session first'}
            disabled={!session || sending}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {running ? (
            <Button variant="danger" onClick={() => void stop()}>
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button disabled={!session || !draft.trim() || sending} onClick={() => void send()}>
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              Send
            </Button>
          )}
        </div>
        <div className="mt-2 text-[11px] text-muted">⌘/Ctrl + Enter to send · Fake runtime for M1</div>
      </footer>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'border-accent/40 text-accent';
    case 'completed':
      return 'border-success/40 text-success';
    case 'failed':
      return 'border-danger/40 text-danger';
    case 'cancelled':
    case 'stopping':
      return 'border-warning/40 text-warning';
    default:
      return '';
  }
}
