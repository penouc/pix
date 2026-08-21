import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Check,
  ChevronDown,
  FolderOpen,
  RefreshCw,
  Square,
  Star,
  Terminal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { HistorySessionMeta, HistoryTranscript } from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';

import {
  AssistantMessage,
  HistoryChatTranscript,
  ToolCard,
  UserMessageBubble,
} from '@/features/chat/ChatTimeline';
import { ThinkingStreamRow } from '@/features/chat/ThinkingStream';
import { invoke } from '@/lib/ipc';
import { useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';
import { useAgentStreamStore } from '@/stores/agent-stream-store';

export type HistoryScope =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'agent'; agent: string }
  | { kind: 'project'; path: string; name: string };

type ExternalTerminal = { id: string; name: string; appPath?: string };

function historyLiveSessionId(key: string): string {
  return `acp-history:${key}`;
}

/**
 * External history transcript. Continue reveals an in-place composer and drives
 * the agent over ACP — no hop to a separate PiX session.
 */
export function HistoryBrowser({ sessionKey }: { sessionKey: string | null }) {
  const [terminalApp, setTerminalApp] = useState('terminal');
  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [live, setLive] = useState(false);
  const [acpRunId, setAcpRunId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();
  const terminalBtnRef = useRef<HTMLButtonElement>(null);
  const terminalMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const acpRunIdRef = useRef<string | null>(null);
  useDismiss(terminalMenuOpen, [terminalBtnRef, terminalMenuRef], () => setTerminalMenuOpen(false));

  const setScope = useAgentStreamStore((s) => s.setScope);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const status = useAgentStreamStore((s) => s.status);
  const liveMessages = useAgentStreamStore((s) => s.messages);
  const liveThinkings = useAgentStreamStore((s) => s.thinkings);
  const liveTools = useAgentStreamStore((s) => s.tools);
  const running = status === 'running' || status === 'stopping';

  useEffect(() => {
    acpRunIdRef.current = acpRunId;
  }, [acpRunId]);

  const transcript = useQuery({
    queryKey: ['history.transcript', sessionKey],
    enabled: Boolean(sessionKey),
    queryFn: () =>
      invoke<HistoryTranscript>({
        method: 'history.transcript',
        params: { key: sessionKey! },
      }),
  });

  const terminals = useQuery({
    queryKey: ['history.listTerminals'],
    queryFn: () =>
      invoke<{ terminals: ExternalTerminal[] }>({
        method: 'history.listTerminals',
        params: {},
      }),
    staleTime: 60_000,
  });

  const terminalOptions = terminals.data?.terminals ?? [{ id: 'terminal', name: 'Terminal' }];
  const selectedTerminal =
    terminalOptions.find((t) => t.id === terminalApp) ?? terminalOptions[0] ?? null;

  useEffect(() => {
    if (!selectedTerminal) return;
    if (terminalApp !== selectedTerminal.id) setTerminalApp(selectedTerminal.id);
  }, [selectedTerminal, terminalApp]);

  // Leaving a session tears down the ACP process and clears live UI state.
  useEffect(() => {
    setLive(false);
    setConnectError(null);
    setDraft('');
    setSending(false);
    const prevRun = acpRunIdRef.current;
    setAcpRunId(null);
    acpRunIdRef.current = null;
    if (prevRun) {
      void invoke({ method: 'acp.abort', params: { runId: prevRun } }).catch(() => undefined);
    }
  }, [sessionKey]);

  useEffect(() => {
    return () => {
      const prevRun = acpRunIdRef.current;
      if (prevRun) {
        void invoke({ method: 'acp.abort', params: { runId: prevRun } }).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [live, liveMessages, liveThinkings, liveTools, running]);

  useEffect(() => {
    if (!live) return;
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft, live]);

  async function resumeTerminal(key: string, appId: string) {
    setTerminalMenuOpen(false);
    setTerminalApp(appId);
    const result = await invoke<{ ok: boolean; command: string; error?: string }>({
      method: 'history.resume',
      params: { key, target: 'terminal', terminalApp: appId },
    });
    if (result.error) {
      window.alert(result.error);
    }
  }

  async function continueSession(meta: HistorySessionMeta) {
    if (continuing || live) return;
    if (!meta.projectPath) {
      window.alert('This session has no project directory to resume in.');
      return;
    }
    setContinuing(true);
    setConnectError(null);
    try {
      const pixSessionId = historyLiveSessionId(meta.key);
      const pixProjectId = 'acp-history';
      resetSessionView();
      setScope(pixProjectId, pixSessionId);
      setLive(true);
      requestAnimationFrame(() => composerRef.current?.focus());

      const started = await invoke<{
        runId: string;
        sessionId: string | null;
        agent: string;
        pixSessionId: string;
        pixProjectId: string;
      }>({
        method: 'acp.start',
        params: {
          agent: meta.agent,
          cwd: meta.projectPath,
          resumeSessionId: meta.nativeId,
          historyKey: meta.key,
          pixSessionId,
          pixProjectId,
        },
      });
      setAcpRunId(started.runId);
    } catch (err) {
      setLive(false);
      setConnectError(err instanceof Error ? err.message : String(err));
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setContinuing(false);
    }
  }

  async function sendPrompt(meta: HistorySessionMeta) {
    const text = draft.trim();
    if (!text || sending) return;
    if (!meta.projectPath) {
      window.alert('This session has no project directory.');
      return;
    }
    setSending(true);
    setDraft('');
    try {
      if (acpRunId) {
        await invoke({
          method: 'acp.prompt',
          params: { runId: acpRunId, prompt: text },
        });
      } else {
        const pixSessionId = historyLiveSessionId(meta.key);
        const pixProjectId = 'acp-history';
        resetSessionView();
        setScope(pixProjectId, pixSessionId);
        const started = await invoke<{ runId: string }>({
          method: 'acp.start',
          params: {
            agent: meta.agent,
            cwd: meta.projectPath,
            prompt: text,
            resumeSessionId: meta.nativeId,
            historyKey: meta.key,
            pixSessionId,
            pixProjectId,
          },
        });
        setAcpRunId(started.runId);
        setLive(true);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      setDraft(text);
    } finally {
      setSending(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  async function abortRun() {
    if (!acpRunId) return;
    await invoke({ method: 'acp.abort', params: { runId: acpRunId } }).catch(() => undefined);
  }

  async function toggleStar(meta: HistorySessionMeta) {
    await invoke({
      method: 'history.star',
      params: { key: meta.key, favorite: !meta.favorite },
    });
    await queryClient.invalidateQueries({ queryKey: ['history.list'] });
    await queryClient.invalidateQueries({ queryKey: ['history.transcript', meta.key] });
  }

  async function refresh() {
    await invoke({ method: 'history.refresh', params: {} });
    await queryClient.invalidateQueries({ queryKey: ['history.list'] });
    await queryClient.invalidateQueries({ queryKey: ['history.nav'] });
    if (sessionKey) {
      await queryClient.invalidateQueries({ queryKey: ['history.transcript', sessionKey] });
    }
  }

  const selected = transcript.data?.meta ?? null;
  const isExternal = selected && selected.origin !== 'pix';

  if (!sessionKey) {
    return <HistoryEmptyHint />;
  }

  if (transcript.isLoading && !selected) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 items-center justify-center text-[12px] text-muted">
        Loading session…
      </div>
    );
  }

  if (transcript.isError) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[14px] font-medium">Couldn’t open this session</div>
        <div className="max-w-md text-[12px] text-muted">
          {transcript.error instanceof Error ? transcript.error.message : String(transcript.error)}
        </div>
        <button
          type="button"
          onClick={() => void transcript.refetch()}
          className="mt-1 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-foreground/[0.06]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!selected || !isExternal) {
    return <HistoryEmptyHint />;
  }

  const timeline = [
    ...liveMessages.map((message) => ({ kind: 'message' as const, order: message.order, message })),
    ...liveThinkings.map((thinking) => ({
      kind: 'thinking' as const,
      order: thinking.order,
      thinking,
    })),
    ...liveTools.map((tool) => ({ kind: 'tool' as const, order: tool.order, tool })),
  ].sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
      <div className="flex w-full flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{selected.title}</div>
          <div className="truncate text-[11px] text-muted">
            {HISTORY_AGENT_DISPLAY[selected.agent]} · {selected.projectPath || 'no path'}
            {live ? ' · live via ACP' : ''}
          </div>
        </div>
        <button
          type="button"
          title="Refresh history index"
          onClick={() => void refresh()}
          className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={selected.favorite ? 'Unstar' : 'Star'}
          onClick={() => void toggleStar(selected)}
          className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-foreground/[0.06]"
        >
          <Star className={cn('h-3.5 w-3.5', selected.favorite && 'fill-current text-accent')} />
        </button>
        <div className="relative">
          <button
            ref={terminalBtnRef}
            type="button"
            onClick={() => setTerminalMenuOpen((open) => !open)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-foreground/[0.06]"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span className="max-w-[7rem] truncate">{selectedTerminal?.name ?? 'Terminal'}</span>
            <ChevronDown className="h-3 w-3 text-muted" />
          </button>
          {terminalMenuOpen ? (
            <div
              ref={terminalMenuRef}
              className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[var(--shadow-md)]"
            >
              {terminalOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void resumeTerminal(selected.key, opt.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-foreground/[0.06]"
                >
                  <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                  {opt.id === selectedTerminal?.id ? (
                    <Check className="h-3.5 w-3.5 flex-none text-accent" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {!live ? (
          <button
            type="button"
            disabled={continuing}
            onClick={() => void continueSession(selected)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] text-accent-foreground disabled:opacity-60"
          >
            {continuing ? 'Starting…' : 'Continue'}
          </button>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto px-5 py-5">
          {transcript.isLoading ? (
            <div className="text-[12px] text-muted">Loading transcript…</div>
          ) : (
            <HistoryChatTranscript
              messages={transcript.data?.messages ?? []}
              agent={selected.agent}
              mode={live ? 'live' : 'readonly'}
            />
          )}
          {live && timeline.length ? (
            <div className="mx-auto mt-4 flex w-full min-w-0 max-w-[760px] flex-col gap-3 border-t border-border/60 pt-4">
              {timeline.map((item) => {
                if (item.kind === 'thinking') {
                  return (
                    <ThinkingStreamRow
                      key={item.thinking.id}
                      content={item.thinking.content}
                      streaming={item.thinking.streaming}
                      expanded
                      onToggle={() => undefined}
                    />
                  );
                }
                if (item.kind === 'tool') {
                  return (
                    <ToolCard
                      key={item.tool.id}
                      tool={item.tool}
                      expanded={false}
                      onToggle={() => undefined}
                    />
                  );
                }
                if (item.message.role === 'user') {
                  return <UserMessageBubble key={item.message.id} content={item.message.content} />;
                }
                return (
                  <AssistantMessage
                    key={item.message.id}
                    content={item.message.content}
                    streaming={item.message.streaming}
                  />
                );
              })}
            </div>
          ) : null}
          {live ? <div className="h-36 flex-none" aria-hidden /> : null}
        </div>

        {live ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background from-[52%] via-background/90 to-transparent px-5 pb-4 pt-10">
            <div className="pointer-events-auto mx-auto w-full min-w-0 max-w-[760px]">
              {connectError ? (
                <div className="mb-2 px-1 text-[11.5px] text-danger">{connectError}</div>
              ) : null}
              <div className="density-composer overflow-hidden rounded-[26px] border border-border bg-surface shadow-[var(--shadow-sm)]">
                <textarea
                  ref={composerRef}
                  rows={1}
                  className="max-h-[160px] min-h-[52px] w-full resize-none overflow-y-hidden bg-transparent px-4 py-3 text-[13.5px] leading-normal outline-none placeholder:text-muted"
                  placeholder={`Message ${HISTORY_AGENT_DISPLAY[selected.agent]}… (⏎ send · ⇧⏎ newline)`}
                  disabled={sending && !running}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    event.preventDefault();
                    void sendPrompt(selected);
                  }}
                />
                <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
                  {running ? (
                    <button
                      type="button"
                      onClick={() => void abortRun()}
                      className="grid h-[30px] w-[30px] place-items-center rounded-full bg-foreground text-background"
                      title="Stop"
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!draft.trim() || sending}
                      onClick={() => void sendPrompt(selected)}
                      className="grid h-[30px] w-[30px] place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
                      title="Send"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function HistoryEmptyHint() {
  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 text-center">
      <FolderOpen className="h-8 w-8 text-muted" />
      <div className="text-[14px] font-medium">No session selected</div>
      <div className="max-w-sm text-[12px] text-muted">
        Pick an agent or project on the left, then a session underneath.
      </div>
    </div>
  );
}
