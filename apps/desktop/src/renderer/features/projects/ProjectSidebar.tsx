import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronRight,
  EyeOff,
  FolderOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { HistoryNav, HistoryProjectNav, ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { activeSidebarProjects, upsertOpenedProjectInNav } from '@/features/projects/history-nav-cache';
import { invoke } from '@/lib/ipc';
import { useAnchorAtPoint, useDismiss } from '@/lib/use-dismiss';
import { listOptionClass, useListKeyboard } from '@/lib/use-list-keyboard';
import { cn } from '@/lib/utils';
import { dotStyle, statusTone, type RunStatus } from '@/lib/status';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface ProjectSidebarProps {
  onOpenSettings: () => void;
  onNewTask: (previousSession: SessionSummary | null, options?: { temporary?: boolean }) => void;
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
  const [archivingPath, setArchivingPath] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  const nav = useQuery({
    queryKey: ['history.nav'],
    queryFn: () => invoke<HistoryNav>({ method: 'history.nav', params: {} }),
    staleTime: 10_000,
  });

  const projects = activeSidebarProjects(nav.data?.projects, 80)
    .map((item) => sidebarProjectFromNav(item))
    .filter((item): item is SidebarProject => item !== null);

  async function refreshProjects() {
    await queryClient.invalidateQueries({ queryKey: ['history.nav'] });
  }

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
      upsertOpenedProjectInNav(queryClient, opened);
      await refreshProjects();
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

  async function archiveProject(item: HistoryProjectNav) {
    if (archivingPath) return;
    setArchivingPath(item.path);
    setOpenError(null);
    queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
      if (!prev) return prev;
      const exists = prev.projects.some((project) => project.path === item.path);
      const nextProjects = exists
        ? prev.projects.map((project) =>
            project.path === item.path ? { ...project, archived: true } : project,
          )
        : [
            ...prev.projects,
            {
              path: item.path,
              name: item.name,
              count: item.count,
              lastActive: item.lastActive,
              archived: true,
              ...(item.pixProjectId ? { pixProjectId: item.pixProjectId } : {}),
            },
          ];
      return { ...prev, projects: nextProjects };
    });
    if (project?.path === item.path) {
      setProject(null);
      setSession(null);
      resetSessionView();
      setScope(null, null);
    }
    try {
      await invoke({
        method: 'history.archiveProject',
        params: { path: item.path, archived: true, name: item.name },
      });
      await refreshProjects();
      await queryClient.invalidateQueries({ queryKey: ['history.listArchived'] });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
      queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          projects: prev.projects.map((project) =>
            project.path === item.path ? { ...project, archived: false } : project,
          ),
        };
      });
    } finally {
      setArchivingPath(null);
    }
  }

  /**
   * Prepare an unstarted task. Session creation is deliberately deferred until
   * the first message, so the project selector above the composer can still
   * change where the task belongs without leaving empty sessions behind.
   */
  async function handleNewTask(into?: SidebarProject) {
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
        upsertOpenedProjectInNav(queryClient, target);
        await refreshProjects();
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setOpening(false);
      }
    }
    onNewTask(prior);
  }

  async function handleTemporaryChat(into?: SidebarProject) {
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
        upsertOpenedProjectInNav(queryClient, target);
        await refreshProjects();
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setOpening(false);
      }
    }
    onNewTask(prior, { temporary: true });
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
          icon={<EyeOff className="h-[15px] w-[15px]" />}
          label="Temporary"
          title="Chat without reading or writing saved memories"
          disabled={busy}
          onClick={() => void handleTemporaryChat()}
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
        <div className="flex h-7 items-center justify-between px-1.5 pb-1">
          <SectionLabel>Projects</SectionLabel>
          <IconButton title="Open project folder" disabled={busy} onClick={onBrowseForProject}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-col gap-px">
          {projects.length ? (
            projects.map((item) => (
              <ProjectBranch
                key={item.id}
                project={item}
                isActive={project?.id === item.id}
                expanded={expanded.has(item.id)}
                busy={busy}
                archiving={archivingPath === item.path}
                activeSessionId={activeSessionId}
                runStatus={status as RunStatus}
                selectedSessionId={session?.id ?? null}
                onToggle={() => toggleExpanded(item.id)}
                onOpenProject={() => void openProjectPath(item.path)}
                onSelectSession={onSelectSession}
                onDeleteSession={(task) => void deleteSession(task)}
                onNewTask={() => void handleNewTask(item)}
                onArchive={() => void archiveProject(item.nav)}
              />
            ))
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

/**
 * One project and, when expanded, its PiX tasks.
 * The query lives here so a collapsed project costs nothing to fetch.
 */
function ProjectBranch({
  project,
  isActive,
  expanded,
  busy,
  archiving,
  activeSessionId,
  runStatus,
  selectedSessionId,
  onToggle,
  onOpenProject,
  onSelectSession,
  onDeleteSession,
  onNewTask,
  onArchive,
}: {
  project: SidebarProject;
  isActive: boolean;
  expanded: boolean;
  busy: boolean;
  archiving: boolean;
  activeSessionId: string | null;
  runStatus: RunStatus;
  selectedSessionId: string | null;
  onToggle: () => void;
  onOpenProject: () => void;
  onSelectSession: (session: SessionSummary, project?: ProjectSummary) => void;
  onDeleteSession: (session: SessionSummary) => void;
  onNewTask: () => void;
  onArchive: () => void;
}) {
  const sessions = useQuery({
    queryKey: ['session.list', project.id],
    enabled: expanded,
    queryFn: () =>
      invoke<SessionSummary[]>({ method: 'session.list', params: { projectId: project.id } }),
  });
  const tasks = (sessions.data ?? []).filter((item) => !item.archived && !item.deletedAt);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuPoint(null), []);

  // Archive is a rare, hiding action. Hover keeps the rightmost control as
  // "new task"; archive only appears from a right-click.

  return (
    <div>
      <div
        className="density-row group flex items-center gap-0.5 rounded-xl pr-1 transition-colors"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPoint({ x: event.clientX, y: event.clientY });
        }}
      >
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
          onClick={() => {
            if (!isActive) onOpenProject();
            if (!expanded) onToggle();
          }}
          className={cn(
            'min-w-0 flex-1 cursor-pointer truncate rounded-xl py-1.5 pr-1 text-left text-[12.5px] transition-colors',
            isActive ? 'text-foreground' : 'text-foreground/60 group-hover:text-foreground',
          )}
        >
          {project.name}
        </button>
        <button
          type="button"
          title={`New task in ${project.name}`}
          aria-label={`New task in ${project.name}`}
          disabled={busy}
          onClick={onNewTask}
          className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover:flex hover:bg-foreground/[0.1] hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {menuPoint ? (
        <ProjectArchiveMenu
          projectName={project.name}
          point={menuPoint}
          disabled={busy || archiving}
          onArchive={onArchive}
          onClose={closeMenu}
        />
      ) : null}

      {expanded ? (
        <div className="mb-0.5 flex flex-col gap-px pl-4">
          {sessions.isLoading ? (
            <EmptyHint>Loading…</EmptyHint>
          ) : tasks.length ? (
            tasks.map((item) => {
              const isSelected = selectedSessionId === item.id;
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
                    onClick={() => onSelectSession(item, projectSummary(project))}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[12.5px]',
                      isSelected
                        ? 'text-foreground'
                        : 'text-foreground/60 group-hover/task:text-foreground',
                    )}
                  >
                    <span
                      className="flex-none rounded-full"
                      style={dotStyle(isLive ? statusTone(runStatus) : 'done')}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                  </button>
                  <button
                    type="button"
                    title="Delete task"
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

function ProjectArchiveMenu({
  projectName,
  point,
  disabled,
  onArchive,
  onClose,
}: {
  projectName: string;
  point: { x: number; y: number };
  disabled: boolean;
  onArchive: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(true, [menuRef], close);
  const style = useAnchorAtPoint(true, point, menuRef);
  const { cursor, setCursor } = useListKeyboard({
    open: true,
    count: 1,
    window: true,
    enabled: () => !disabled,
    onSelect: () => {
      if (disabled) return;
      onArchive();
      onClose();
    },
    onClose: close,
  });

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${projectName} actions`}
      style={style ?? { position: 'fixed', left: point.x, top: point.y }}
      onContextMenu={(event) => event.preventDefault()}
      className="z-50 min-w-[168px] overflow-hidden rounded-[16px] border border-border bg-background py-1 shadow-[var(--shadow-lg)]"
    >
      <button
        type="button"
        role="menuitem"
        data-active={cursor === 0 ? 'true' : undefined}
        disabled={disabled}
        onMouseEnter={() => setCursor(0)}
        onClick={() => {
          if (disabled) return;
          onArchive();
          onClose();
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-[12.5px]',
          listOptionClass(cursor === 0),
          disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        <Archive className="h-3.5 w-3.5 flex-none text-muted" />
        Archive
      </button>
    </div>,
    document.body,
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

interface SidebarProject {
  id: string;
  path: string;
  name: string;
  nav: HistoryProjectNav;
}

function sidebarProjectFromNav(item: HistoryProjectNav): SidebarProject | null {
  if (!item.pixProjectId) return null;
  return {
    id: item.pixProjectId,
    path: item.path,
    name: item.name,
    nav: item,
  };
}

function projectSummary(item: SidebarProject): ProjectSummary {
  return {
    id: item.id,
    path: item.path,
    name: item.name,
    trusted: true,
    isGit: false,
    lastOpenedAt: item.nav.lastActive,
  };
}
