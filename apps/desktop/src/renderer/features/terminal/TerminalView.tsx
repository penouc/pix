import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ProjectSummary, TerminalCwdResult, TerminalResult } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * One scrollback line. A `cd` shares the shape so the transcript stays a single
 * list, and `kind` is what lets it drop the exit-code footer that would be
 * meaningless for a directory change.
 */
type Entry = TerminalResult & { kind?: 'cd' };

interface TerminalTab {
  id: number;
  /** Absolute directory this tab runs in, or '.' for the project root. */
  cwd: string;
  /** Project-relative label for `cwd`. */
  label: string;
  /** Where `cd -` goes back to. */
  previousCwd: string;
  entries: Entry[];
}

/**
 * A `cd` this view handles itself, rather than a command to run.
 *
 * Only a bare `cd` qualifies. `cd build && pnpm test` still goes to the shell,
 * where the directory change applies to that one command and then goes away —
 * which is what a subshell does, and what the scrollback will show.
 */
const BARE_CD = /^cd(?:\s+(.+))?$/;

function parseCd(command: string): { target: string } | null {
  if (/[;&|`]|\$\(/.test(command)) return null;
  const match = BARE_CD.exec(command);
  return match ? { target: match[1] ?? '' } : null;
}

/** `project` at the root, `project/sub/dir` below it. */
function promptLabel(project: ProjectSummary | null, cwd: string): string {
  const name = project?.name ?? 'no project';
  if (!project || cwd === '.' || cwd === project.path) return name;
  // Windows separators: compare and slice on a slash-normalised form so a
  // `C:\repo` project labels its subdirectories the same way as a macOS one.
  const normalizedCwd = cwd.replace(/\\/g, '/');
  const normalizedProject = project.path.replace(/\\/g, '/');
  if (normalizedCwd.startsWith(`${normalizedProject}/`)) {
    return `${name}/${normalizedCwd.slice(normalizedProject.length + 1)}`;
  }
  return cwd;
}

/**
 * A `cd` rendered into the scrollback.
 *
 * `from` is the directory the command was typed in — not where it landed. A real
 * terminal shows the old prompt on the `cd` line and the new one underneath, and
 * labelling it with the destination made the transcript read as though you were
 * already there.
 */
function cwdEntry(command: string, from: string, result: TerminalCwdResult): Entry {
  return {
    kind: 'cd',
    command,
    cwd: from,
    outcome: result.outcome === 'changed' ? 'ran' : 'denied',
    exitCode: result.outcome === 'changed' ? 0 : null,
    output: result.outcome === 'changed' ? result.relative : '',
    truncated: false,
    durationMs: 0,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * A command runner, not a shell. Each line is executed once.
 *
 * Commands you type are not held for approval — you are the one acting, so the
 * keystroke is the consent. The policy floor still applies: a protected path or
 * a path outside the project is refused, and read-only mode refuses bash
 * entirely. Every command is audited either way.
 *
 * There is no PTY, so interactive programs (vim, top) will not work; that is a
 * deliberate limit, not a bug.
 */
export function TerminalView() {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 1, cwd: '.', label: '.', previousCwd: '.', entries: [] },
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

  /** Append one scrollback entry to the tab that produced it. */
  function append(tabId: number, entry: Entry) {
    setTabs((all) =>
      all.map((tab) => (tab.id === tabId ? { ...tab, entries: [...tab.entries, entry] } : tab)),
    );
  }

  async function changeDirectory(command: string, target: string) {
    if (!project) return;
    // `cd -` is the tab's own history, so it is resolved here and then validated
    // in Main like any other target.
    const requested = target === '-' ? current.previousCwd : target;
    const result = await invoke<TerminalCwdResult>({
      method: 'terminal.changeDirectory',
      params: {
        projectId: project.id,
        ...(current.cwd === '.' ? {} : { cwd: current.cwd }),
        target: requested === '.' ? '' : requested,
      },
    });

    if (result.outcome === 'changed') {
      setTabs((all) =>
        all.map((tab) =>
          tab.id === current.id
            ? {
                ...tab,
                cwd: result.cwd,
                label: result.relative,
                previousCwd: tab.cwd,
                entries: [...tab.entries, cwdEntry(command, tab.cwd, result)],
              }
            : tab,
        ),
      );
      return;
    }
    append(current.id, cwdEntry(command, current.cwd, result));
  }

  async function run() {
    const command = draft.trim();
    if (!command || !project || busy) return;
    setDraft('');
    setBusy(true);
    try {
      const cd = parseCd(command);
      if (cd) {
        await changeDirectory(command, cd.target);
        return;
      }
      const result = await invoke<TerminalResult>({
        method: 'terminal.exec',
        params: {
          projectId: project.id,
          command,
          cwd: current.cwd === '.' ? undefined : current.cwd,
          sessionId: session?.id,
        },
      });
      append(current.id, result);
    } catch (error) {
      append(current.id, {
        command,
        cwd: current.cwd,
        outcome: 'denied',
        exitCode: null,
        output: '',
        truncated: false,
        durationMs: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-output)]">
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
                ? 'bg-[var(--color-output)] text-white'
                : 'bg-transparent text-white/45 hover:text-white/80',
            )}
          >
            {/* The label is the tab's own directory — that is the thing that now
                differs between tabs, and the project name is the same for all. */}
            {tab.label === '.' ? (project?.name ?? 'no project') : tab.label}
          </button>
        ))}
        <button
          type="button"
          title="New terminal"
          onClick={() => {
            const id = Math.max(...tabs.map((tab) => tab.id)) + 1;
            setTabs((all) => [
              ...all,
              // A new tab opens where you were, the way a real terminal does.
              {
                id,
                cwd: current.cwd,
                label: current.label,
                previousCwd: current.cwd,
                entries: [],
              },
            ]);
            setActive(id);
          }}
          className="ml-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/55 hover:bg-white/10 hover:text-white/85"
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
          <div className="text-white/45">Open a project to run commands.</div>
        ) : !current.entries.length ? (
          <div className="text-white/45">
            Commands run once inside {project.name}. Yours run without asking; paths outside the
            project are still refused. Interactive programs are not supported.
          </div>
        ) : null}

        {current.entries.map((entry, index) => (
          <div key={`${index}-${entry.command}`} className="mb-3.5">
            <div>
              <span className="text-accent-2-400">➜</span>{' '}
              {/* The directory each command actually ran in, not the current one
                  — scrollback after a `cd` would otherwise misattribute it. */}
              <span className="text-accent-200">{promptLabel(project, entry.cwd)}</span>{' '}
              {entry.command}
            </div>
            {entry.outcome !== 'ran' ? (
              <pre className="mt-1 mb-0 whitespace-pre-wrap text-accent-300">
                {entry.outcome === 'denied' ? 'refused: ' : 'cancelled: '}
                {entry.reason ?? 'no reason given'}
              </pre>
            ) : entry.kind === 'cd' ? null : (
              <pre className="mt-1 mb-0 whitespace-pre-wrap opacity-90">
                {entry.output || '(no output)'}
              </pre>
            )}
            {entry.outcome === 'ran' && entry.kind !== 'cd' ? (
              <div className="mt-0.5 text-[11px] text-white/40">
                exit {entry.exitCode ?? '—'} · {entry.durationMs}ms
                {entry.truncated ? ' · output truncated' : ''}
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="text-white/45">
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
        <span className="text-accent-200">{promptLabel(project, current.cwd)}</span>
        <input
          ref={inputRef}
          className="flex-1 border-0 bg-transparent p-0 font-mono text-[12.5px] text-[var(--color-output-foreground)] outline-none placeholder:text-white/35"
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
