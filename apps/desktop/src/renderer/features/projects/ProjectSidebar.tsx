import { useQuery } from '@tanstack/react-query';
import {
  FolderOpen,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  X,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { Segmented } from '@/components/ui/segmented';
import { useCreateTask } from '@/features/sessions/use-create-task';
import { invoke } from '@/lib/ipc';
import { dotStyle, statusTone } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export type SidebarDestination = 'terminal' | 'automations' | 'skills';

interface ProjectSidebarProps {
  onOpenSettings: () => void;
  onNewTask: () => void;
  onSelectSession: () => void;
  onOpenSearch: () => void;
  /** Open the OS folder picker directly — no intermediate dialog. */
  onBrowseForProject: () => void;
  /** Error from a project opened elsewhere (⌘O), shown with the local ones. */
  externalError?: string | null;
  /** Switched to another project — land on the unstarted-task screen. */
  onProjectSwitched: () => void;
  onNavigate: (destination: SidebarDestination) => void;
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
  onBrowseForProject,
  externalError,
  onProjectSwitched,
  onNavigate,
  activeNav,
  isBlankRun,
}: ProjectSidebarProps) {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const status = useAgentStreamStore((s) => s.status);
  const activeSessionId = useAgentStreamStore((s) => s.activeSessionId);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);

  const { createTask, busy: creating, error: createError } = useCreateTask();
  /** Last soft-deleted task, offered back as an Undo rather than a modal. */
  const [undoable, setUndoable] = useState<SessionSummary | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const busy = creating || opening;
  const error = openError ?? createError ?? externalError ?? null;

  const recent = useQuery({
    queryKey: ['project.listRecent'],
    queryFn: () => invoke<ProjectSummary[]>({ method: 'project.listRecent' }),
  });

  const sessions = useQuery({
    queryKey: ['session.list', project?.id],
    enabled: Boolean(project?.id),
    queryFn: () =>
      invoke<SessionSummary[]>({ method: 'session.list', params: { projectId: project!.id } }),
  });

  async function openProjectPath(path: string) {
    if (!path.trim()) return;
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
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }

  /**
   * New task, always. When no project is open this used to raise the project
   * picker instead — a button labelled "New task" that asked for a folder — so
   * it now falls back to the playground workspace and puts the task there.
   */
  async function handleNewTask() {
    let target = project;
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
    // Passed explicitly: the store selector above is still the old value in this
    // tick when the playground was only just opened.
    const created = await createTask(target);
    if (created) onNewTask();
  }

  async function setSessionDeleted(item: SessionSummary, deleted: boolean) {
    try {
      await invoke<SessionSummary>({
        method: 'session.delete',
        params: { sessionId: item.id, deleted },
      });
      setUndoable(deleted ? item : null);
      if (deleted && session?.id === item.id) {
        setSession(null);
        resetSessionView();
        if (project) setScope(project.id, null);
      }
      await sessions.refetch();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectSession(item: SessionSummary) {
    setSession(item);
    resetSessionView();
    setScope(item.projectId, item.id);
    onSelectSession();
  }

  const tasks = sessions.data ?? [];

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
          icon={<SquareTerminal className="h-[15px] w-[15px]" />}
          label="Terminal"
          active={activeNav === 'terminal'}
          onClick={() => onNavigate('terminal')}
        />
        <NavItem
          icon={<Zap className="h-[15px] w-[15px]" />}
          label="Automations"
          active={activeNav === 'automations'}
          onClick={() => onNavigate('automations')}
        />
        <NavItem
          icon={<Sparkles className="h-[15px] w-[15px]" />}
          label="Skills"
          active={activeNav === 'skills'}
          onClick={() => onNavigate('skills')}
        />
      </nav>

      <div className="mx-3 mt-3 mb-2.5 h-px bg-border" />

      {/* Scope + list actions */}
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
        <Segmented
          size="sm"
          aria-label="Group tasks by"
          options={[{ value: 'project', label: 'Project' }]}
          value="project"
        />
        <div className="flex gap-0.5">
          <IconButton title="Filtering isn't implemented yet" disabled>
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Open project folder" disabled={busy} onClick={onBrowseForProject}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {error ? (
        <div className="px-3.5 pb-2 text-[11px] leading-snug text-danger">{error}</div>
      ) : null}

      {/* Lists */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <SectionLabel>Projects</SectionLabel>
        <div className="mb-3.5 flex flex-col gap-px">
          {recent.data?.length ? (
            recent.data.slice(0, 6).map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.path}
                disabled={busy}
                onClick={() => void openProjectPath(item.path)}
                className={cn(
                  'w-full cursor-pointer truncate rounded-xl px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                  project?.id === item.id
                    ? 'bg-accent-soft text-accent-800'
                    : 'text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground',
                )}
              >
                {item.name}
              </button>
            ))
          ) : (
            <EmptyHint>No projects yet</EmptyHint>
          )}
        </div>

        <div className="flex items-center justify-between py-1 pr-0.5 pl-1.5">
          <span className="text-[10px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
            Tasks
          </span>
          <IconButton title="New task" disabled={busy} onClick={() => void handleNewTask()}>
            <Plus className="h-3 w-3" />
          </IconButton>
        </div>
        <div className="flex flex-col gap-px">
          {tasks.length ? (
            tasks.map((item) => {
              const isSelected = session?.id === item.id;
              // The pulsing dot marks the session that actually owns the run.
              const isLive = item.id === activeSessionId;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'density-row group flex items-center gap-1 rounded-xl pr-1 transition-colors',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-foreground/[0.07]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectSession(item)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12.5px]',
                      isSelected
                        ? 'text-foreground'
                        : 'text-foreground/60 group-hover:text-foreground',
                    )}
                  >
                    <span style={dotStyle(isLive ? statusTone(status) : 'done')} />
                    <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                  </button>
                  <button
                    type="button"
                    title="Delete task (recoverable — nothing is erased)"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void setSessionDeleted(item, true)}
                    className="hidden h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted group-hover:flex hover:bg-foreground/[0.1] hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          ) : (
            <EmptyHint>{project ? 'No tasks yet' : 'Open a project first'}</EmptyHint>
          )}
        </div>

        {undoable ? (
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-foreground/[0.06] px-2.5 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-muted">Deleted “{undoable.title}”</span>
            <button
              type="button"
              className="flex-none cursor-pointer font-semibold text-accent-700 hover:underline"
              onClick={() => void setSessionDeleted(undoable, false)}
            >
              Undo
            </button>
          </div>
        ) : null}
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
    <div className="px-1.5 pt-0.5 pb-1 text-[10px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: string }) {
  return <div className="px-1.5 py-1 text-[11.5px] text-foreground/40">{children}</div>;
}
