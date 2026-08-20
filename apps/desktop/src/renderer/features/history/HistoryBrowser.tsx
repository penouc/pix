import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FolderOpen, RefreshCw, Star, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { HistoryNav, HistorySessionMeta, HistoryTranscript } from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';

import { HistoryChatTranscript } from '@/features/chat/ChatTimeline';
import { invoke } from '@/lib/ipc';
import { useDismiss } from '@/lib/use-dismiss';
import { cn } from '@/lib/utils';

export type HistoryScope =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'agent'; agent: string }
  | { kind: 'project'; path: string; name: string };

type ExternalTerminal = { id: string; name: string; appPath?: string };

/**
 * Full-width read-only transcript for an external history session.
 * Session picking lives in the sidebar under Agents / Projects.
 */
export function HistoryBrowser({
  sessionKey,
  onContinueInPix,
}: {
  sessionKey: string | null;
  onContinueInPix: (meta: HistorySessionMeta) => Promise<void> | void;
}) {
  const [terminalApp, setTerminalApp] = useState('terminal');
  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const queryClient = useQueryClient();
  const terminalBtnRef = useRef<HTMLButtonElement>(null);
  const terminalMenuRef = useRef<HTMLDivElement>(null);
  useDismiss(terminalMenuOpen, [terminalBtnRef, terminalMenuRef], () => setTerminalMenuOpen(false));

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

  async function continueInPix(meta: HistorySessionMeta) {
    if (continuing) return;
    setContinuing(true);
    try {
      await onContinueInPix(meta);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setContinuing(false);
    }
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

  if (!selected || !isExternal) {
    // PiX sessions open in the workbench; keep a quiet placeholder if we land here.
    return <HistoryEmptyHint />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col">
      <div className="flex w-full flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{selected.title}</div>
          <div className="truncate text-[11px] text-muted">
            {HISTORY_AGENT_DISPLAY[selected.agent]} · {selected.projectPath || 'no path'}
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
        <button
          type="button"
          disabled={continuing}
          onClick={() => void continueInPix(selected)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] text-accent-foreground disabled:opacity-60"
        >
          {continuing ? 'Starting…' : 'Continue in PiX'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {transcript.isLoading ? (
          <div className="text-[12px] text-muted">Loading transcript…</div>
        ) : (
          <HistoryChatTranscript
            messages={transcript.data?.messages ?? []}
            agent={selected.agent}
          />
        )}
      </div>
    </div>
  );
}

export function useHistoryNav() {
  return useQuery({
    queryKey: ['history.nav'],
    queryFn: () => invoke<HistoryNav>({ method: 'history.nav', params: {} }),
    staleTime: 15_000,
  });
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
