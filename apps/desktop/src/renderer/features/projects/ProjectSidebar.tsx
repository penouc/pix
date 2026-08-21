import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type {
  HistoryNav,
  HistoryProjectNav,
  HistorySessionMeta,
  ProjectSummary,
  SessionSummary,
} from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';

import type { HistoryScope } from '@/features/history/HistoryBrowser';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface ProjectSidebarProps {
  onOpenSettings: () => void;
  onNewTask: (previousSession: SessionSummary | null) => void;
  onSelectSession: (session: SessionSummary, project?: ProjectSummary) => void;
  onOpenSearch: () => void;
  onOpenAutomations: () => void;
  onOpenSkills: () => void;
  onBrowseForProject: () => void;
  externalError?: string | null;
  onProjectSwitched: () => void;
  activeNav: string;
  isBlankRun: boolean;
  historyScope: HistoryScope;
  historySessionKey: string | null;
  onHistoryScope: (scope: HistoryScope) => void;
  onSelectHistorySession: (session: HistorySessionMeta) => void;
}

export function ProjectSidebar({
  onOpenSettings,
  onNewTask,
  onSelectSession: _onSelectSession,
  onOpenSearch,
  onOpenAutomations,
  onOpenSkills,
  onBrowseForProject,
  externalError,
  onProjectSwitched,
  activeNav,
  isBlankRun,
  historyScope,
  historySessionKey,
  onHistoryScope,
  onSelectHistorySession,
}: ProjectSidebarProps) {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [archivingPath, setArchivingPath] = useState<string | null>(null);
  const [archivingSessionKey, setArchivingSessionKey] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showEmptyAgents, setShowEmptyAgents] = useState(false);
  const queryClient = useQueryClient();

  const nav = useQuery({
    queryKey: ['history.nav'],
    queryFn: () => invoke<HistoryNav>({ method: 'history.nav', params: {} }),
    staleTime: 10_000,
  });

  const scopedSessions = useQuery({
    queryKey: ['history.list', historyScope],
    enabled: historyScope.kind === 'agent' || historyScope.kind === 'project',
    queryFn: () =>
      invoke<{ sessions: HistorySessionMeta[]; total: number }>({
        method: 'history.list',
        params:
          historyScope.kind === 'agent'
            ? { agent: historyScope.agent, limit: 80 }
            : historyScope.kind === 'project'
              ? { projectPath: historyScope.path, limit: 80 }
              : { limit: 80 },
      }),
  });

  useEffect(() => {
    setShowAllSessions(false);
  }, [historyScope]);

  // Keep the empty-agents fold open when the active filter is one of them.
  useEffect(() => {
    if (historyScope.kind !== 'agent') return;
    const empty = (nav.data?.agents ?? []).some(
      (a) => a.count === 0 && a.agent === historyScope.agent,
    );
    if (empty) setShowEmptyAgents(true);
  }, [historyScope, nav.data?.agents]);

  // Auto-open the first session when the agent / project filter changes.
  useEffect(() => {
    const sessions = scopedSessions.data?.sessions;
    if (!sessions?.length) return;
    if (historySessionKey && sessions.some((s) => s.key === historySessionKey)) return;
    onSelectHistorySession(sessions[0]!);
  }, [scopedSessions.data, historySessionKey, onSelectHistorySession]);

  const recent = useQuery({
    queryKey: ['project.listRecent'],
    queryFn: () => invoke<ProjectSummary[]>({ method: 'project.listRecent' }),
  });

  async function openProjectPath(path: string): Promise<ProjectSummary | null> {
    if (!path.trim() || opening) return null;
    setOpening(true);
    setOpenError(null);
    try {
      const opened = await invoke<ProjectSummary>({
        method: 'project.open',
        params: { path: path.trim() },
      });
      setProject(opened);
      setSession(null);
      resetSessionView();
      setScope(opened.id, null);
      void recent.refetch();
      onProjectSwitched();
      return opened;
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setOpening(false);
    }
  }

  async function handleNewTask(into?: ProjectSummary) {
    const prior = session;
    let target = into ?? project;
    if (into && into.id !== project?.id) {
      target = await openProjectPath(into.path);
      if (!target) return;
    }
    if (!target) {
      setOpening(true);
      setOpenError(null);
      try {
        target = await invoke<ProjectSummary>({ method: 'project.openPlayground' });
        setProject(target);
        setSession(null);
        resetSessionView();
        setScope(target.id, null);
        void recent.refetch();
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setOpening(false);
      }
    }
    onNewTask(prior);
  }

  const busy = opening;
  const error = openError ?? externalError ?? null;
  const agents = nav.data?.agents ?? [];
  const agentsWithSessions = agents.filter((a) => a.count > 0);
  const emptyAgents = agents.filter((a) => a.count === 0);
  const sessions = scopedSessions.data?.sessions ?? [];
  const sessionsLoading = scopedSessions.isLoading;
  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, 5);
  const hiddenSessionCount = Math.max(0, sessions.length - 5);
  const playgroundNames = new Map(
    (recent.data ?? [])
      .filter((p) => p.isPlayground)
      .map((p) => [
        p.path,
        p.name === 'playground' ? 'Scratch playground' : p.name,
      ] as const),
  );

  const allProjects = (nav.data?.projects ?? [])
    .filter((p) => !p.archived)
    .map((p) => ({
      ...p,
      name: playgroundNames.get(p.path) ?? p.name,
    }));
  const activeProjects = allProjects.slice(0, 24);

  function sessionListUnder(active: boolean) {
    if (!active) return null;
    if (sessionsLoading && !sessions.length) {
      return <EmptyHint>Loading…</EmptyHint>;
    }
    if (!sessions.length) {
      return <EmptyHint>No sessions</EmptyHint>;
    }
    return (
      <div className="mb-0.5 flex flex-col gap-px pl-4">
        {visibleSessions.map((item) => (
          <SessionRow
            key={item.key}
            session={item}
            active={
              historySessionKey === item.key ||
              Boolean(item.pixSessionId && item.pixSessionId === session?.id)
            }
            archiving={archivingSessionKey === item.key}
            onClick={() => onSelectHistorySession(item)}
            onArchive={() => void archiveSession(item)}
          />
        ))}
        {hiddenSessionCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAllSessions((v) => !v)}
            className="px-2 py-1.5 text-left text-[11.5px] text-foreground/40 hover:text-foreground"
          >
            {showAllSessions ? 'Show less' : `Show ${hiddenSessionCount} more`}
          </button>
        ) : null}
      </div>
    );
  }

  async function archiveSession(item: HistorySessionMeta) {
    if (archivingSessionKey) return;
    setArchivingSessionKey(item.key);
    setOpenError(null);
    try {
      await invoke({
        method: 'history.archiveSession',
        params: { key: item.key, archived: true },
      });
      await queryClient.invalidateQueries({ queryKey: ['history.list'] });
      await queryClient.invalidateQueries({ queryKey: ['history.nav'] });
      await queryClient.invalidateQueries({ queryKey: ['history.listArchived'] });
      if (historySessionKey === item.key) onHistoryScope({ kind: 'none' });
    } catch (err) {
      setOpenError(shortError(err));
    } finally {
      setArchivingSessionKey(null);
    }
  }

  async function setProjectArchived(item: HistoryProjectNav, archived: boolean) {
    if (archivingPath) return;
    setArchivingPath(item.path);
    // Optimistic: move the row immediately so archive feels instant.
    queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
      if (!prev) return prev;
      const exists = prev.projects.some((p) => p.path === item.path);
      const projects = exists
        ? prev.projects.map((p) => (p.path === item.path ? { ...p, archived } : p))
        : archived
          ? [
              ...prev.projects,
              {
                path: item.path,
                name: item.name,
                count: item.count,
                lastActive: item.lastActive,
                archived: true,
                ...(item.pixProjectId ? { pixProjectId: item.pixProjectId } : {}),
              },
            ]
          : prev.projects;
      return { ...prev, projects };
    });
    if (
      archived &&
      historyScope.kind === 'project' &&
      historyScope.path === item.path
    ) {
      onHistoryScope({ kind: 'agent', agent: 'pix' });
    }
    try {
      await invoke({
        method: 'history.archiveProject',
        params: { path: item.path, archived, name: item.name },
      });
      await queryClient.invalidateQueries({ queryKey: ['history.nav'] });
      await queryClient.invalidateQueries({ queryKey: ['history.listArchived'] });
    } catch (err) {
      setOpenError(shortError(err));
      // Roll back optimistic flag.
      queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          projects: prev.projects.map((p) =>
            p.path === item.path ? { ...p, archived: !archived } : p,
          ),
        };
      });
    } finally {
      setArchivingPath(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex flex-col gap-px px-2 pt-1.5">
        <NavItem
          icon={<Plus className="h-[15px] w-[15px]" />}
          label="New task"
          shortcut="⌘N"
          active={activeNav === 'run' && isBlankRun}
          disabled={busy}
          onClick={() => void handleNewTask()}
        />
        <NavItem
          icon={<Search className="h-[15px] w-[15px]" />}
          label="Search"
          shortcut="⌘K"
          onClick={onOpenSearch}
        />
        <NavItem
          icon={<Zap className="h-[15px] w-[15px]" />}
          label="Automations"
          active={activeNav === 'automations'}
          onClick={onOpenAutomations}
        />
        <NavItem
          icon={<Sparkles className="h-[15px] w-[15px]" />}
          label="Skills"
          active={activeNav === 'skills'}
          onClick={onOpenSkills}
        />
      </nav>

      <div className="mx-3 mt-3 mb-2.5 h-px bg-border" />

      {error ? (
        <div className="px-3.5 pb-2 text-[11px] leading-snug text-danger">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <div className="flex h-7 items-center px-1.5 pb-1">
          <SectionLabel>Agents</SectionLabel>
        </div>
        <div className="flex flex-col gap-px">
          {agents.length ? (
            <>
              {agentsWithSessions.map((agent) => {
                const expanded =
                  historyScope.kind === 'agent' && historyScope.agent === agent.agent;
                return (
                  <div key={agent.agent}>
                    <FilterRow
                      label={agent.displayName || HISTORY_AGENT_DISPLAY[agent.agent]}
                      count={agent.count}
                      expanded={expanded}
                      muted={!agent.detected}
                      onClick={() =>
                        onHistoryScope(
                          expanded
                            ? { kind: 'none' }
                            : { kind: 'agent', agent: agent.agent },
                        )
                      }
                    />
                    {sessionListUnder(expanded)}
                  </div>
                );
              })}
              {emptyAgents.length ? (
                <div className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowEmptyAgents((v) => !v)}
                    className="density-row group flex w-full items-center gap-0.5 rounded-xl pr-1 text-left transition-colors"
                  >
                    <span className="flex h-6 w-5 flex-none items-center justify-center text-muted">
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          !showEmptyAgents && '-rotate-90',
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate py-1.5 pr-1 text-[12.5px] text-foreground/45 group-hover:text-foreground/70">
                      No sessions
                      <span className="ml-1.5 text-[11px] text-foreground/35">
                        {emptyAgents.length}
                      </span>
                    </span>
                  </button>
                  {showEmptyAgents ? (
                    <div className="mb-0.5 flex flex-col gap-px pl-4">
                      {emptyAgents.map((agent) => {
                        const expanded =
                          historyScope.kind === 'agent' && historyScope.agent === agent.agent;
                        return (
                          <div key={agent.agent}>
                            <FilterRow
                              label={
                                agent.displayName || HISTORY_AGENT_DISPLAY[agent.agent]
                              }
                              count={agent.count}
                              expanded={expanded}
                              muted={!agent.detected}
                              onClick={() =>
                                onHistoryScope(
                                  expanded
                                    ? { kind: 'none' }
                                    : { kind: 'agent', agent: agent.agent },
                                )
                              }
                            />
                            {sessionListUnder(expanded)}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : nav.isLoading ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : (
            <EmptyHint>No agents yet</EmptyHint>
          )}
        </div>

        <div className="mx-1.5 my-2.5 h-px bg-border" />

        <div className="flex h-7 items-center justify-between px-1.5 pb-1">
          <SectionLabel>Projects</SectionLabel>
          <IconButton title="Open project folder" disabled={busy} onClick={onBrowseForProject}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-col gap-px">
          {activeProjects.length ? (
            activeProjects.map((item) => {
              const expanded =
                historyScope.kind === 'project' && historyScope.path === item.path;
              return (
                <div key={item.path}>
                  <FilterRow
                    label={item.name}
                    count={item.count}
                    title={item.path}
                    expanded={expanded}
                    onClick={() => {
                      if (expanded) {
                        onHistoryScope({ kind: 'none' });
                        return;
                      }
                      onHistoryScope({ kind: 'project', path: item.path, name: item.name });
                      if (item.pixProjectId && item.pixProjectId !== project?.id) {
                        void openProjectPath(item.path);
                      }
                    }}
                    action={{
                      title: 'Archive project',
                      icon: <Archive className="h-3 w-3" />,
                      disabled: archivingPath === item.path,
                      onClick: () => void setProjectArchived(item, true),
                    }}
                  />
                  {sessionListUnder(expanded)}
                </div>
              );
            })
          ) : nav.isLoading ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : (
            <EmptyHint>No projects yet — open a folder to begin</EmptyHint>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center border-t border-border px-2.5 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-[30px] w-full cursor-pointer items-center justify-start gap-2.5 rounded-full px-2.5 text-[12.5px] text-foreground/[0.68] transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <Settings className="h-[15px] w-[15px]" />
          Settings
        </button>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  active,
  archiving,
  onClick,
  onArchive,
}: {
  session: HistorySessionMeta;
  active?: boolean;
  archiving?: boolean;
  onClick: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={cn(
        'density-row group/task flex items-center gap-1 rounded-xl pr-1 transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-foreground/[0.07]',
      )}
    >
      <button
        type="button"
        title={session.title || 'Untitled'}
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[12.5px]',
          active ? 'text-foreground' : 'text-foreground/60 group-hover/task:text-foreground',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{session.title || 'Untitled'}</span>
        {session.favorite ? (
          <Star className="h-3 w-3 flex-none fill-current text-accent" />
        ) : null}
        <span className="flex-none tabular-nums text-[11px] opacity-50">
          {relativeTime(session.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        title="Archive session"
        aria-label={`Archive ${session.title || 'session'}`}
        disabled={archiving}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onArchive();
        }}
        className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover/task:flex hover:bg-foreground/[0.1] hover:text-foreground disabled:opacity-40"
      >
        <Archive className="h-3 w-3" />
      </button>
    </div>
  );
}

function relativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const first = raw.split('\n')[0]?.trim() || 'Something went wrong';
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

function FilterRow({
  label,
  count,
  expanded,
  muted,
  title,
  onClick,
  action,
}: {
  label: string;
  count: number;
  expanded?: boolean;
  muted?: boolean;
  title?: string;
  onClick?: () => void;
  action?: {
    title: string;
    icon: ReactNode;
    disabled?: boolean;
    onClick: () => void;
  };
}) {
  return (
    <div
      title={title}
      className={cn(
        'density-row group flex items-center gap-0.5 rounded-xl pr-1 transition-colors',
        muted && !expanded ? 'opacity-55' : null,
      )}
    >
      <button
        type="button"
        title={expanded ? 'Hide sessions' : 'Show sessions'}
        aria-expanded={expanded}
        onClick={onClick}
        className="flex h-6 w-5 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:text-foreground"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
        />
      </button>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'min-w-0 flex-1 cursor-pointer truncate rounded-xl py-1.5 pr-1 text-left text-[12.5px] transition-colors',
          expanded
            ? 'text-foreground'
            : 'text-foreground/60 group-hover:text-foreground',
        )}
      >
        {label}
        <span className="ml-1.5 text-[11px] text-foreground/40">{count}</span>
      </button>
      {action ? (
        <button
          type="button"
          title={action.title}
          aria-label={action.title}
          disabled={action.disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            action.onClick();
          }}
          className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover:flex hover:bg-foreground/[0.1] hover:text-foreground disabled:opacity-40"
        >
          {action.icon}
        </button>
      ) : null}
    </div>
  );
}

function NavItem({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  title,
}: {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[13px] transition-colors',
        active
          ? 'bg-background text-foreground shadow-[var(--shadow-sm)]'
          : 'text-foreground/[0.68]',
        disabled
          ? 'cursor-not-allowed opacity-45'
          : 'cursor-pointer hover:bg-foreground/[0.07] hover:text-foreground',
      )}
    >
      {icon ? <span className="flex-none opacity-80">{icon}</span> : null}
      <span className="flex-1 text-left">{label}</span>
      {shortcut ? <span className="font-mono text-[11px] opacity-50">{shortcut}</span> : null}
    </button>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors not-disabled:cursor-pointer not-disabled:hover:bg-foreground/[0.08] not-disabled:hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: string }) {
  return <div className="px-1.5 py-1 text-[11.5px] text-foreground/40">{children}</div>;
}
