import { useQuery } from '@tanstack/react-query';
import { MoreVertical, Plus, Search, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { SessionSummary, WorkingTreeDiff } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import {
  dotStyle,
  fileBadgeStyle,
  fileKindBadge,
  formatDuration,
  formatRelative,
  formatTokens,
  NOT_REPORTED,
  patchLineStats,
  statusTone,
  toneBadge,
} from '@/lib/status';
import { cn } from '@/lib/utils';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface HomeViewProps {
  onNewTask: () => void;
  onOpenSession: () => void;
  onReviewChanges: () => void;
  onSelectSession: (session: SessionSummary) => void;
  onOpenAutomations: () => void;
  /** Bumped by ⌘K to move focus into the task filter. */
  filterFocusToken?: number;
}

/**
 * The design's home screen: the task list beside a detail column that reports
 * what the selected task did and what it changed.
 *
 * Only the active session has live run state (status, steps, duration, tokens);
 * the app does not persist per-run step/test/cost history yet, so those slots
 * say so rather than showing invented numbers.
 */
export function HomeView({
  onNewTask,
  onOpenSession,
  onReviewChanges,
  onSelectSession,
  onOpenAutomations,
  filterFocusToken = 0,
}: HomeViewProps) {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const status = useAgentStreamStore((s) => s.status);
  const tools = useAgentStreamStore((s) => s.tools);
  const usage = useAgentStreamStore((s) => s.usage);
  const startedAt = useAgentStreamStore((s) => s.startedAt);
  const activeSessionId = useAgentStreamStore((s) => s.activeSessionId);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterFocusToken > 0) filterRef.current?.focus();
  }, [filterFocusToken]);

  const sessions = useQuery({
    queryKey: ['session.list', project?.id],
    enabled: Boolean(project?.id),
    queryFn: () =>
      invoke<SessionSummary[]>({ method: 'session.list', params: { projectId: project!.id } }),
  });

  const diff = useQuery({
    queryKey: ['git.workingTreeDiff', project?.id],
    enabled: Boolean(project?.trusted && project.isGit),
    queryFn: () =>
      invoke<WorkingTreeDiff>({
        method: 'git.getWorkingTreeDiff',
        params: { projectId: project!.id },
      }),
  });

  const tasks = useMemo(() => sessions.data ?? [], [sessions.data]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((task) => task.title.toLowerCase().includes(needle));
  }, [tasks, filter]);

  // Run state belongs to the session that owns the active run, not to whichever
  // row is selected — otherwise picking task B while A streams labels B running.
  const live = session && session.id === activeSessionId ? status : 'idle';
  const changedFiles = diff.data?.files ?? [];
  const lineStats = patchLineStats(diff.data?.patch);

  const summaryLine = (() => {
    if (!project) return 'Open a project to see its tasks';
    const parts = [`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`];
    if (live === 'running' || live === 'starting') parts.push('1 running');
    if (live === 'waiting_for_approval') parts.push('1 waiting on you');
    return parts.join(' · ');
  })();

  return (
    <div className="flex min-h-0 flex-1">
      {/* Task list */}
      <div className="flex w-[392px] flex-none flex-col border-r border-border">
        <div className="flex items-end gap-3 px-5 pt-5 pb-3">
          <div className="flex-1">
            <h3 className="mb-0.5">Tasks</h3>
            <div className="text-[12.5px] text-muted">{summaryLine}</div>
          </div>
          <Button size="default" onClick={onNewTask} disabled={!project}>
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3.5 h-[15px] w-[15px] -translate-y-1/2 opacity-45" />
            <input
              ref={filterRef}
              className="input border-transparent bg-foreground/[0.05] pl-9"
              placeholder="Filter tasks by title…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        </div>

        <div className="density-gap flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pt-0.5 pb-4">
          {visible.map((task) => {
            const selected = session?.id === task.id;
            const isLive = task.id === activeSessionId;
            const tone = isLive ? statusTone(status) : 'done';
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectSession(task)}
                className={cn(
                  'density-row flex w-full cursor-pointer flex-col gap-[7px] rounded-[20px] border px-3.5 py-3 text-left transition-colors',
                  selected
                    ? 'border-accent/30 bg-surface shadow-[var(--shadow-sm)]'
                    : 'border-transparent hover:bg-foreground/[0.06]',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span style={dotStyle(tone, 8)} />
                  <span className="min-w-0 flex-1 truncate text-sm leading-tight font-bold">
                    {task.title}
                  </span>
                  <span className="flex-none text-[11px] text-muted">
                    {formatRelative(task.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-[19px]">
                  {isLive && status !== 'idle' ? (
                    <Badge tone={toneBadge[tone]} className="px-2.5 py-0.5 text-[10.5px]">
                      {status}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="px-2.5 py-0.5 text-[10.5px]">
                      {task.archived ? 'archived' : 'session'}
                    </Badge>
                  )}
                  <span className="font-mono text-[11px] text-muted">{project?.name}</span>
                </div>
              </button>
            );
          })}

          {!visible.length ? (
            <div className="flex flex-col items-start gap-2 px-3 py-6 text-[12.5px] text-muted">
              <span>
                {project
                  ? filter
                    ? `No task matches “${filter}”.`
                    : 'No tasks yet — start one with New task.'
                  : 'Open a project from the sidebar to begin.'}
              </span>
              {filter ? (
                <Button variant="secondary" size="sm" onClick={() => setFilter('')}>
                  Clear search
                </Button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onOpenAutomations}
            className="mt-2 flex cursor-pointer items-start gap-3 rounded-[22px] border border-dashed border-foreground/20 px-4 py-3.5 text-left transition-colors hover:bg-foreground/[0.04]"
          >
            <Zap className="mt-0.5 h-4 w-4 flex-none text-accent" />
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[13px] font-bold">Automations</span>
              </div>
              <div className="text-[11.5px] leading-relaxed text-muted">
                Queue a saved prompt to run on a schedule. Each one opens a normal task you can
                review, keep or revert.
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Detail */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-7 pt-6 pb-7">
        {!session ? (
          <div className="mt-16 text-center text-[13px] text-muted">
            Select a task, or start a new one.
          </div>
        ) : (
          <>
            <div>
              {live !== 'idle' ? (
                <Badge tone={toneBadge[statusTone(live)]}>{live}</Badge>
              ) : (
                <Badge tone="neutral">session</Badge>
              )}
              <h2 className="mt-2 mb-1.5 max-w-[600px]">{session.title}</h2>
              <div className="font-mono text-[12.5px] text-muted">
                {[
                  project?.name,
                  `session ${session.id.slice(0, 8)}`,
                  `updated ${formatRelative(session.updatedAt)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Button size="lg" onClick={onOpenSession}>
                Open session
              </Button>
              <Button size="lg" variant="secondary" onClick={onReviewChanges}>
                Review changes
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="w-[34px] p-0"
                disabled
                title="No task actions menu yet"
              >
                <MoreVertical className="h-[15px] w-[15px]" />
              </Button>
            </div>

            <div className="card elev-sm gap-[var(--space-3)]">
              <div className="card-kicker">What it did</div>
              {tools.length ? (
                <div className="flex flex-col gap-2.5">
                  {tools.map((tool, index) => {
                    const done = tool.status === 'completed';
                    return (
                      <div key={tool.id} className="flex items-start gap-3">
                        <span
                          className="grid h-[19px] w-[19px] flex-none place-items-center rounded-full text-[10.5px] font-bold"
                          style={
                            done
                              ? { background: 'var(--color-accent-2)', color: 'var(--color-bg)' }
                              : {
                                  border:
                                    '1.5px solid color-mix(in srgb, var(--color-text) 25%, transparent)',
                                }
                          }
                        >
                          {index + 1}
                        </span>
                        <span
                          className={cn('text-[13px] leading-normal', done && 'opacity-[0.62]')}
                        >
                          <span className="font-semibold">{tool.toolName}</span>{' '}
                          <span className="font-mono text-[12px]">{tool.inputSummary}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12.5px] leading-relaxed text-muted">
                  Step history isn&apos;t persisted yet, so this only fills in while a run is live
                  in this session.
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <StatCard kicker="Changed" value={String(changedFiles.length)}>
                working tree files
                {lineStats ? ` · +${lineStats.added} −${lineStats.deleted}` : ''}
              </StatCard>
              <StatCard kicker="Checks" value={NOT_REPORTED} muted>
                test runs aren&apos;t tracked
              </StatCard>
              <StatCard
                kicker="Run"
                value={
                  session.id === activeSessionId && startedAt
                    ? formatDuration(startedAt)
                    : NOT_REPORTED
                }
              >
                {usage?.totalTokens != null
                  ? `${formatTokens(usage.totalTokens)} tokens`
                  : 'no usage reported'}
              </StatCard>
            </div>

            <div>
              <h6 className="mt-1 mb-2 opacity-60">Working tree · compared with HEAD</h6>
              {changedFiles.length ? (
                <div className="flex flex-col gap-0.5">
                  {changedFiles.map((file) => {
                    const badge = fileKindBadge[file.status] ?? fileKindBadge.modified!;
                    return (
                      <div
                        key={file.path}
                        className="flex items-center gap-2.5 rounded-[14px] px-3 py-[7px] font-mono text-xs hover:bg-foreground/[0.05]"
                      >
                        <span style={fileBadgeStyle(badge.background)}>{badge.letter}</span>
                        <span className="min-w-0 flex-1 truncate" title={file.path}>
                          {file.path}
                        </span>
                        {file.binary ? <span className="text-muted">binary</span> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12.5px] text-muted">
                  {project?.isGit
                    ? project.trusted
                      ? 'Working tree is clean.'
                      : 'Trust the project to read its working tree.'
                    : 'Not a Git project — no diff to show.'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  kicker,
  value,
  muted,
  children,
}: {
  kicker: string;
  value: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card elev-sm flex-1 gap-[5px]">
      <div className="card-kicker">{kicker}</div>
      <div className={cn('text-[25px] leading-none font-bold', muted && 'text-muted')}>{value}</div>
      <div className="text-[11.5px] text-muted">{children}</div>
    </div>
  );
}
