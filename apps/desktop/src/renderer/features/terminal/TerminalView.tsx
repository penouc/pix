import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { DesktopAgentEvent, TerminalOpenResult } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface TerminalTab {
  id: number;
  /** Main-side PTY session id once opened. */
  sessionId: string | null;
  /** Project-relative label for the tab strip. */
  label: string;
  /** Absolute start cwd (project root when '.'). */
  cwd: string;
  error: string | null;
  exited: boolean;
}

interface HostedTerminal {
  term: Terminal;
  fit: FitAddon;
  sessionId: string | null;
  disposed: boolean;
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function buildXtermTheme(): ConstructorParameters<typeof Terminal>[0] {
  const foreground = readCssColor('--color-output-foreground', '#f1f1f2');
  const background = readCssColor('--color-output', '#1d1e21');
  const accent = readCssColor('--color-accent-2-400', '#93c4ad');
  const cursor = readCssColor('--color-accent-2', '#5d9e82');
  return {
    convertEol: true,
    cursorBlink: true,
    fontFamily: readCssColor(
      '--font-mono',
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    ),
    fontSize: 12.5,
    lineHeight: 1.35,
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      foreground,
      background,
      cursor,
      cursorAccent: background,
      selectionBackground: 'rgba(93, 158, 130, 0.35)',
      selectionForeground: foreground,
      black: '#1d1e21',
      red: '#e06c75',
      green: accent,
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: foreground,
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: accent,
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  };
}

function decodePtyData(event: Extract<DesktopAgentEvent, { type: 'terminal.data' }>): string {
  if (event.data != null) return event.data;
  const binary = atob(event.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Interactive PTY terminal (ADR-0006).
 *
 * Each tab owns a Main-side `node-pty` session and a renderer xterm instance.
 * Typed input is consent; the agent bash tool remains on its separate
 * non-interactive permission path.
 */
export function TerminalView() {
  const project = useWorkspaceStore((s) => s.project);
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 1, sessionId: null, label: '.', cwd: '.', error: null, exited: false },
  ]);
  const [active, setActive] = useState(1);
  const hostRef = useRef<HTMLDivElement>(null);
  const hostsRef = useRef(new Map<number, HostedTerminal>());
  const nextIdRef = useRef(2);
  const projectRef = useRef(project);
  projectRef.current = project;

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;

  function showOnly(tabId: number) {
    for (const [id, other] of hostsRef.current) {
      if (!other.term.element) continue;
      other.term.element.style.display = id === tabId ? 'block' : 'none';
    }
  }

  /** Open (or reopen) a PTY for a tab and attach xterm. */
  async function ensureSession(tabId: number) {
    const projectNow = projectRef.current;
    const hostEl = hostRef.current;
    if (!projectNow || !hostEl) return;

    let hosted = hostsRef.current.get(tabId);
    if (!hosted) {
      const fit = new FitAddon();
      const term = new Terminal(buildXtermTheme());
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      hosted = { term, fit, sessionId: null, disposed: false };
      hostsRef.current.set(tabId, hosted);
      term.open(hostEl);
      fit.fit();

      term.onData((data) => {
        const sessionId = hosted?.sessionId;
        if (!sessionId || hosted?.disposed) return;
        void invoke({ method: 'terminal.write', params: { sessionId, data } }).catch(() => {
          /* session may have exited */
        });
      });
    }

    showOnly(tabId);

    if (hosted.sessionId) {
      hosted.fit.fit();
      void invoke({
        method: 'terminal.resize',
        params: {
          sessionId: hosted.sessionId,
          cols: hosted.term.cols,
          rows: hosted.term.rows,
        },
      }).catch(() => {});
      hosted.term.focus();
      return;
    }

    try {
      hosted.fit.fit();
      const cols = Math.max(hosted.term.cols, 2);
      const rows = Math.max(hosted.term.rows, 1);
      const opened = await invoke<TerminalOpenResult>({
        method: 'terminal.open',
        params: {
          projectId: projectNow.id,
          cols,
          rows,
        },
      });
      if (hosted.disposed) {
        void invoke({ method: 'terminal.close', params: { sessionId: opened.sessionId } });
        return;
      }
      hosted.sessionId = opened.sessionId;
      setTabs((all) =>
        all.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                sessionId: opened.sessionId,
                cwd: opened.cwd,
                label: opened.relative,
                error: null,
                exited: false,
              }
            : tab,
        ),
      );
      hosted.term.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTabs((all) =>
        all.map((tab) => (tab.id === tabId ? { ...tab, error: message, exited: true } : tab)),
      );
      hosted.term.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
    }
  }

  async function disposeTab(tabId: number) {
    const hosted = hostsRef.current.get(tabId);
    if (!hosted) return;
    hosted.disposed = true;
    const sessionId = hosted.sessionId;
    hosted.sessionId = null;
    hostsRef.current.delete(tabId);
    hosted.term.dispose();
    if (sessionId) {
      await invoke({ method: 'terminal.close', params: { sessionId } }).catch(() => {});
    }
  }

  // Project gate / (re)open active tab session.
  useEffect(() => {
    if (!project) return;
    void ensureSession(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureSession closes over refs
  }, [project?.id, active]);

  // Tear down every PTY when the project changes or the view unmounts.
  useEffect(() => {
    const hosts = hostsRef.current;
    return () => {
      for (const id of [...hosts.keys()]) {
        void disposeTab(id);
      }
    };
  }, [project?.id]);

  // Stream PTY output into the matching xterm.
  useEffect(() => {
    if (!window.piDesktop) return;
    return window.piDesktop.onAgentEvent((event: DesktopAgentEvent) => {
      if (event.type === 'terminal.data') {
        for (const hosted of hostsRef.current.values()) {
          if (hosted.sessionId !== event.ptySessionId || hosted.disposed) continue;
          hosted.term.write(decodePtyData(event));
          break;
        }
        return;
      }
      if (event.type === 'terminal.exit') {
        for (const [tabId, hosted] of hostsRef.current) {
          if (hosted.sessionId !== event.ptySessionId) continue;
          hosted.sessionId = null;
          setTabs((all) =>
            all.map((tab) =>
              tab.id === tabId
                ? {
                    ...tab,
                    sessionId: null,
                    exited: true,
                    error: `Shell exited (${event.exitCode ?? 'signal'})`,
                  }
                : tab,
            ),
          );
          hosted.term.writeln(
            `\r\n\x1b[90m[process exited with code ${event.exitCode ?? 'null'}]\x1b[0m`,
          );
          break;
        }
      }
    });
  }, []);

  // Fit + resize on container size changes and when the active tab gains focus.
  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;
    const observer = new ResizeObserver(() => {
      const hosted = hostsRef.current.get(active);
      if (!hosted || hosted.disposed) return;
      hosted.fit.fit();
      if (!hosted.sessionId) return;
      void invoke({
        method: 'terminal.resize',
        params: {
          sessionId: hosted.sessionId,
          cols: hosted.term.cols,
          rows: hosted.term.rows,
        },
      }).catch(() => {});
    });
    observer.observe(hostEl);
    return () => observer.disconnect();
  }, [active]);

  function addTab() {
    const id = nextIdRef.current++;
    setTabs((all) => [
      ...all,
      {
        id,
        sessionId: null,
        label: current.label,
        cwd: current.cwd,
        error: null,
        exited: false,
      },
    ]);
    setActive(id);
  }

  async function closeTab(tabId: number) {
    if (tabs.length === 1) {
      await disposeTab(tabId);
      const id = nextIdRef.current++;
      setTabs([{ id, sessionId: null, label: '.', cwd: '.', error: null, exited: false }]);
      setActive(id);
      return;
    }
    await disposeTab(tabId);
    setTabs((all) => {
      const remaining = all.filter((tab) => tab.id !== tabId);
      if (!remaining.some((tab) => tab.id === active)) {
        setActive(remaining[remaining.length - 1]!.id);
      }
      return remaining;
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-output)]">
      <div className="flex flex-none items-center gap-0.5 px-3 pt-2">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'group flex items-center gap-1 rounded-t-xl px-2 py-1.5 font-mono text-[11.5px]',
              tab.id === active
                ? 'bg-[var(--color-output)] text-white'
                : 'bg-transparent text-white/45 hover:text-white/80',
            )}
          >
            <button
              type="button"
              onClick={() => setActive(tab.id)}
              className="cursor-pointer border-0 bg-transparent px-1.5 py-0.5 font-mono text-[11.5px] text-inherit"
            >
              {tab.label === '.' ? (project?.name ?? 'no project') : tab.label}
            </button>
            <button
              type="button"
              title="Close terminal"
              onClick={() => void closeTab(tab.id)}
              className="grid h-4 w-4 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-white/35 opacity-0 hover:bg-white/10 hover:text-white/80 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          title="New terminal"
          onClick={addTab}
          disabled={!project}
          className="ml-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/55 hover:bg-white/10 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-[var(--color-output)]">
        {!project ? (
          <div className="px-5 py-3.5 font-mono text-[12.5px] text-white/45">
            Open a project to use the terminal.
          </div>
        ) : null}
        {project && current.error && !current.sessionId ? (
          <div className="absolute inset-x-0 top-0 z-10 px-5 py-2 font-mono text-[12px] text-accent-300">
            {current.error}
          </div>
        ) : null}
        <div
          ref={hostRef}
          className="pi-xterm-host h-full w-full px-3 py-2"
          onMouseDown={() => {
            const hosted = hostsRef.current.get(active);
            hosted?.term.focus();
          }}
        />
      </div>
    </div>
  );
}
