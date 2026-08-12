import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FolderOpen, Plus, Search, Settings, Sparkles, X, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { dotStyle, statusTone, type RunStatus } from '@/lib/status';
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
  /** Open the OS folder picker directly — no intermediate dialog. */
  onBrowseForProject: () => void;
  /** Error from a project opened elsewhere (⌘O), shown with the local ones. */
  externalError?: string | null;
  /** Switched to another project — land on the unstarted-task screen. */
  onProjectSwitched: () => void;
  /** Which nav entry reads as current. */
  activeNav: string;
  /** True while the run screen is showing an unstarted task. */
  isBlankRun: boolean;
}

export function ProjectSidebar({
  onOpenSettings,
  onNewTask,
  onSelectSession,
  onOpenSearch,
  onOpenAutomations,
  onOpenSkills,
  onBrowseForProject,
  externalError,
  onProjectSwitched,
  activeNav,
  isBlankRun,
}: ProjectSidebarProps) {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const status = useAgentStreamStore((s) => s.status);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const activeSessionId = useAgentStreamStore((s) => s.activeSessionId);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);

  /** Which projects show their tasks. The open one starts expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Expanding the project you just opened, without fighting a manual collapse:
  // this only ever adds, so closing it again sticks.
  useEffect(() => {
    if (!project?.id) return;
    setExpanded((current) =>
      current.has(project.id) ? current : new Set([...current, project.id]),
    );
  }, [project?.id]);

  function toggleExpanded(projectId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  const busy = opening;
  const error = openError ?? externalError ?? null;

  const queryClient = useQueryClient();
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
      // No task is selected in the project you just switched to, so the run
      // screen would otherwise keep showing the previous project's thread.
      onProjectSwitched();
      return opened;
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setOpening(false);
    }
  }

  /**
   * Prepare an unstarted task. Session creation is deliberately deferred until
   * the first message, so the project selector above the composer can still
   * change where the task belongs without leaving empty sessions behind.
   */
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

  async function deleteSession(item: SessionSummary) {
    try {
      const isRunning =
        status === 'starting' ||
        status === 'running' ||
        status === 'waiting_for_approval' ||
        status === 'stopping';
      if (item.id === activeSessionId && activeRunId && isRunning) {
        await invoke({ method: 'agent.abort', params: { runId: activeRunId } });
      }
      await invoke<SessionSummary>({
        method: 'session.delete',
        params: { sessionId: item.id, deleted: true },
      });
      if (session?.id === item.id) {
        setSession(null);
        resetSessionView();
        if (project) setScope(project.id, null);
      }
      await queryClient.invalidateQueries({ queryKey: ['session.list'] });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectSession(item: SessionSummary, fromProject?: ProjectSummary) {
    onSelectSession(item, fromProject);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Navigation */}
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

      {/*
        The "group tasks by: Project" control and the disabled filter button are
        gone. The first had a single option and so could never change anything —
        and grouping by project is now the structure of the list itself, not a
        setting. The second only ever said it was not implemented.
      */}
      {error ? (
        <div className="px-3.5 pb-2 text-[11px] leading-snug text-danger">{error}</div>
      ) : null}

      {/* Projects, each owning its own task list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <div className="flex h-7 items-center justify-between px-1.5 pb-1">
          <SectionLabel>Projects</SectionLabel>
          <IconButton title="Open project folder" disabled={busy} onClick={onBrowseForProject}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-col gap-px">
          {recent.data?.length ? (
            recent.data
              .slice(0, 12)
              .map((item) => (
                <ProjectBranch
                  key={item.id}
                  project={
                    item.isPlayground
                      ? { ...item, name: item.name === 'playground' ? 'Scratch playground' : item.name }
                      : item
                  }
                  isActive={project?.id === item.id}
                  expanded={expanded.has(item.id)}
                  busy={busy}
                  activeSessionId={activeSessionId}
                  runStatus={status}
                  selectedSessionId={session?.id ?? null}
                  onToggle={() => toggleExpanded(item.id)}
                  onOpenProject={() => void openProjectPath(item.path)}
                  onSelectSession={selectSession}
                  onDeleteSession={(item) => void deleteSession(item)}
                  onNewTask={() => void handleNewTask(item)}
                />
              ))
          ) : (
            <EmptyHint>No projects yet — open a folder to begin</EmptyHint>
          )}
        </div>
      </div>

      {/* Footer */}
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

/**
 * One project and, when expanded, its tasks.
 *
 * Tasks used to live in a single flat list below the projects, showing only the
 * open project's — so the other projects' work was invisible and the heading was
 * the only thing telling you which project you were looking at. Nesting them puts
 * each task under the thing it belongs to, and lets you see more than one at once.
 *
 * The query lives here rather than in the parent so a collapsed project costs
 * nothing: `enabled` keeps it from fetching until it is opened.
 */
function ProjectBranch({
  project,
  isActive,
  expanded,
  busy,
  activeSessionId,
  runStatus,
  selectedSessionId,
  onToggle,
  onOpenProject,
  onSelectSession,
  onDeleteSession,
  onNewTask,
}: {
  project: ProjectSummary;
  isActive: boolean;
  expanded: boolean;
  busy: boolean;
  activeSessionId: string | null;
  runStatus: RunStatus;
  selectedSessionId: string | null;
  onToggle: () => void;
  onOpenProject: () => void;
  onSelectSession: (session: SessionSummary, project?: ProjectSummary) => void;
  onDeleteSession: (session: SessionSummary) => void;
  onNewTask: () => void;
}) {
  const sessions = useQuery({
    queryKey: ['session.list', project.id],
    enabled: expanded,
    queryFn: () =>
      invoke<SessionSummary[]>({ method: 'session.list', params: { projectId: project.id } }),
  });
  const tasks = sessions.data ?? [];

  return (
    <div>
      <div className="density-row group flex items-center gap-0.5 rounded-xl pr-1 transition-colors">
        <button
          type="button"
          title={expanded ? 'Hide tasks' : 'Show tasks'}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex h-6 w-5 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:text-foreground"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          title={project.path}
          // Clicking the name opens the project and reveals its tasks: wanting one
          // without the other is not a thing anybody wants here.
          onClick={() => {
            if (!isActive) onOpenProject();
            onToggle();
          }}
          className="min-w-0 flex-1 cursor-pointer truncate rounded-xl py-1.5 pr-1 text-left text-[12.5px] text-foreground/60 transition-colors group-hover:text-foreground"
        >
          {project.name}
        </button>
        <button
          type="button"
          title={`New task in ${project.name}`}
          aria-label={`New task in ${project.name}`}
          disabled={busy}
          onClick={onNewTask}
          className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover:flex hover:bg-foreground/[0.1] hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {expanded ? (
        <div className="mb-0.5 flex flex-col gap-px pl-4">
          {sessions.isLoading ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : tasks.length ? (
            tasks.map((item) => {
              const isSelected = selectedSessionId === item.id;
              // The pulsing dot marks the session that actually owns the run.
              const isLive = item.id === activeSessionId;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'density-row group/task flex items-center gap-1 rounded-xl pr-1 transition-colors',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-foreground/[0.07]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(item, project)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[12.5px]',
                      isSelected
                        ? 'text-foreground'
                        : 'text-foreground/60 group-hover/task:text-foreground',
                    )}
                  >
                    <span style={dotStyle(isLive ? statusTone(runStatus) : 'done')} />
                    <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                  </button>
                  <button
                    type="button"
                    title="Delete task (recoverable — nothing is erased)"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => onDeleteSession(item)}
                    className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover/task:flex hover:bg-foreground/[0.1] hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          ) : (
            <EmptyHint>No tasks yet</EmptyHint>
          )}
        </div>
      ) : null}
    </div>
  );
}
