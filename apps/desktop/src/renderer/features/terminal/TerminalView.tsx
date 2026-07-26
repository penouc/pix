import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { TerminalResult } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface TerminalTab {
  id: number;
  title: string;
  cwd: string;
  entries: TerminalResult[];
}

/**
 * A command runner, not a shell. Each line is executed once through the same
 * permission pipeline the agent's bash tool uses — so a protected path or a
 * workspace escape is refused, and an elevated command raises the normal
 * approval. There is no PTY, so interactive programs (vim, top) will not work;
 * that is a deliberate limit, not a bug.
 */
export function TerminalView() {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 1, title: 'shell', cwd: '.', entries: [] },
  ]);
  const [active, setActive] = useState(1);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;

  useEffect(() => {
    const element = scrollerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [tabs, active, busy]);

  async function run() {
    const command = draft.trim();
    if (!command || !project || busy) return;
    setDraft('');
    setBusy(true);
    try {
      const result = await invoke<TerminalResult>({
        method: 'terminal.exec',
        params: {
          projectId: project.id,
          command,
          cwd: current.cwd === '.' ? undefined : current.cwd,
          sessionId: session?.id,
        },
      });
      setTabs((all) =>
        all.map((tab) =>
          tab.id === current.id ? { ...tab, entries: [...tab.entries, result] } : tab,
        ),
      );
    } catch (error) {
      setTabs((all) =>
        all.map((tab) =>
          tab.id === current.id
            ? {
                ...tab,
                entries: [
                  ...tab.entries,
                  {
                    command,
                    cwd: current.cwd,
                    outcome: 'denied',
                    exitCode: null,
                    output: '',
                    truncated: false,
                    durationMs: 0,
                    reason: error instanceof Error ? error.message : String(error),
                  },
                ],
              }
            : tab,
        ),
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-neutral-900">
      {/* Tabs */}
      <div className="flex flex-none items-center gap-0.5 px-3 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={cn(
              'cursor-pointer rounded-t-xl border-0 px-3.5 py-2 font-mono text-[11.5px]',
              tab.id === active
                ? 'bg-[var(--color-output)] text-neutral-100'
                : 'bg-transparent text-neutral-500 hover:text-neutral-300',
            )}
          >
            {tab.title} — {project?.name ?? 'no project'}
          </button>
        ))}
        <button
          type="button"
          title="New terminal"
          onClick={() => {
            const id = Math.max(...tabs.map((tab) => tab.id)) + 1;
            setTabs((all) => [...all, { id, title: `shell ${id}`, cwd: '.', entries: [] }]);
            setActive(id);
          }}
          className="ml-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-neutral-400 hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollback */}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-output)] px-5 py-3.5 font-mono text-[12.5px] leading-[1.7] text-[var(--color-output-foreground)]"
      >
        {!project ? (
          <div className="text-neutral-500">Open a project to run commands.</div>
        ) : !current.entries.length ? (
          <div className="text-neutral-500">
            Commands run once inside {project.name} and go through the same approval policy as the
            agent&apos;s bash tool. Interactive programs are not supported.
          </div>
        ) : null}

        {current.entries.map((entry, index) => (
          <div key={`${index}-${entry.command}`} className="mb-3.5">
            <div>
              <span className="text-accent-2-400">➜</span>{' '}
              <span className="text-accent-200">{project?.name}</span> {entry.command}
            </div>
            {entry.outcome !== 'ran' ? (
              <pre className="mt-1 mb-0 whitespace-pre-wrap text-accent-300">
                {entry.outcome === 'denied' ? 'refused: ' : 'cancelled: '}
                {entry.reason ?? 'no reason given'}
              </pre>
            ) : (
              <pre className="mt-1 mb-0 whitespace-pre-wrap opacity-90">
                {entry.output || '(no output)'}
              </pre>
            )}
            {entry.outcome === 'ran' ? (
              <div className="mt-0.5 text-[11px] text-neutral-500">
                exit {entry.exitCode ?? '—'} · {entry.durationMs}ms
                {entry.truncated ? ' · output truncated' : ''}
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="text-neutral-500">
            running…{' '}
            <span
              className="inline-block h-3.5 w-1.5 align-middle bg-[var(--color-output-foreground)]"
              style={{ animation: 'pi-blink 1s step-end infinite' }}
            />
          </div>
        ) : null}
      </div>

      {/* Prompt */}
      <div className="flex flex-none items-center gap-2 bg-[var(--color-output)] px-5 pt-2.5 pb-4 font-mono text-[12.5px] text-[var(--color-output-foreground)]">
        <span className="text-accent-2-400">➜</span>
        <span className="text-accent-200">{current.cwd === '.' ? project?.name : current.cwd}</span>
        <input
          ref={inputRef}
          className="flex-1 border-0 bg-transparent p-0 font-mono text-[12.5px] text-[var(--color-output-foreground)] outline-none placeholder:text-neutral-600"
          placeholder={project ? 'pnpm test …' : 'open a project first'}
          disabled={!project || busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void run();
            }
          }}
        />
      </div>
    </div>
  );
}
