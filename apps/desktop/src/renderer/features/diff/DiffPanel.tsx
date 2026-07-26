import { ChevronLeft } from 'lucide-react';

import { parsePatchFiles } from '@pierre/diffs';
import { CodeView, type CodeViewDiffItem, type CodeViewHandle } from '@pierre/diffs/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useRef, useState } from 'react';

import type { WorkingTreeDiff } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useUiPrefsStore } from '@/stores/ui-prefs-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface RecoveryConflict {
  path: string;
  reason: string;
}

interface CheckpointReview {
  paths: string[];
  outcome?: string;
  conflicts: RecoveryConflict[];
}

interface RecoveryResult {
  outcome: 'reverted' | 'conflicted';
  conflicts: RecoveryConflict[];
}

export function DiffPanel({
  onContinue,
  recoveryRunId,
  onRecoveryResolved,
  onBack,
}: {
  onContinue: () => void;
  recoveryRunId?: string;
  onRecoveryResolved: () => void;
  onBack?: () => void;
}) {
  const project = useWorkspaceStore((s) => s.project);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const reviewRunId = recoveryRunId ?? activeRunId;
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const diffStyle = useUiPrefsStore((s) => s.diffStyle);
  const setDiffStyle = useUiPrefsStore((s) => s.set);
  const compactContext = useUiPrefsStore((s) => s.collapseContext);
  const resolvedTheme = useUiPrefsStore((s) => s.resolvedTheme);
  const [recoveryConflicts, setRecoveryConflicts] = useState<RecoveryConflict[]>([]);
  const enabled = Boolean(project?.trusted && project.isGit);
  const diff = useQuery({
    queryKey: ['git.workingTreeDiff', project?.id],
    queryFn: () =>
      invoke<WorkingTreeDiff>({
        method: 'git.getWorkingTreeDiff',
        params: { projectId: project!.id },
      }),
    enabled,
  });
  const checkpoint = useQuery({
    queryKey: ['checkpoint.review', reviewRunId],
    queryFn: () =>
      invoke<CheckpointReview>({
        method: 'checkpoint.review',
        params: { runId: reviewRunId! },
      }),
    enabled: Boolean(reviewRunId),
    retry: false,
  });

  const items = useMemo(() => {
    if (!diff.data?.patch) return [];
    try {
      return parsePatchFiles(diff.data.patch, 'working-tree').flatMap((patch, patchIndex) =>
        patch.files.map((file, fileIndex): CodeViewDiffItem => ({
          id: `working-tree-${patchIndex}-${fileIndex}-${file.name}`,
          type: 'diff',
          fileDiff: file,
        })),
      );
    } catch {
      return [];
    }
  }, [diff.data?.patch]);

  const changedFiles = diff.data?.files ?? [];
  const snapshotPaths = new Set(checkpoint.data?.paths ?? []);

  async function checkpointAction(
    method: 'checkpoint.keep' | 'checkpoint.continue' | 'checkpoint.revertAll',
  ) {
    if (!reviewRunId) return;
    const result = await invoke<RecoveryResult | { outcome: string }>({
      method,
      params: { runId: reviewRunId },
    });
    if ('conflicts' in result) setRecoveryConflicts(result.conflicts);
    await checkpoint.refetch();
    if (method === 'checkpoint.continue') onContinue();
    if (
      recoveryRunId &&
      (method === 'checkpoint.keep' ||
        (method === 'checkpoint.revertAll' && result.outcome === 'reverted'))
    ) {
      onRecoveryResolved();
    }
    if (method === 'checkpoint.revertAll') await diff.refetch();
  }

  async function revertFile(snapshotPath: string) {
    if (!reviewRunId) return;
    const result = await invoke<RecoveryResult>({
      method: 'checkpoint.revertFile',
      params: { runId: reviewRunId, path: snapshotPath },
    });
    setRecoveryConflicts(result.conflicts);
    await checkpoint.refetch();
    await diff.refetch();
  }

  function scrollToFile(path: string) {
    const item = items.find((candidate) => candidate.fileDiff.name === path);
    if (!item) return;
    codeViewRef.current?.scrollTo({
      type: 'item',
      id: item.id,
      align: 'start',
      behavior: 'smooth',
    });
  }

  if (recoveryRunId) {
    return (
      <RecoveryPanel
        checkpoint={checkpoint.data}
        isLoading={checkpoint.isLoading}
        error={checkpoint.error}
        onKeep={() => void checkpointAction('checkpoint.keep')}
        onRevertAll={() => void checkpointAction('checkpoint.revertAll')}
        onRevertFile={(snapshotPath) => void revertFile(snapshotPath)}
      />
    );
  }
  if (!project) {
    return <DiffEmptyState title="Open a Git project to review changes." />;
  }
  if (!project.trusted) {
    return <DiffEmptyState title="Trust this project before reviewing its diff." />;
  }
  if (!project.isGit) {
    return <DiffEmptyState title="Diff review is available for Git projects." />;
  }
  if (diff.isLoading) {
    return <DiffEmptyState title="Loading working-tree diff…" />;
  }
  if (diff.isError) {
    return (
      <DiffEmptyState
        title={diff.error instanceof Error ? diff.error.message : 'Unable to load diff.'}
        action={<Button onClick={() => void diff.refetch()}>Retry</Button>}
      />
    );
  }
  if (!diff.data?.patch) {
    return <DiffEmptyState title="No tracked changes compared with HEAD." />;
  }
  if (items.length === 0 && changedFiles.length === 0) {
    return <DiffEmptyState title="This diff could not be rendered." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          {onBack ? (
            <Button variant="quiet" size="icon" onClick={onBack} title="Back">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div>
            <div className="text-sm font-medium">Review changes</div>
            <div className="text-xs text-muted">
              {changedFiles.length} changed {changedFiles.length === 1 ? 'file' : 'files'} ·
              compared with HEAD
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Segmented
            size="sm"
            aria-label="Diff style"
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Split' },
            ]}
            value={diffStyle}
            onChange={(value) => setDiffStyle('diffStyle', value)}
          />
          <Button
            variant={compactContext ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setDiffStyle('collapseContext', !compactContext)}
          >
            {compactContext ? 'Compact context' : 'More context'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void diff.refetch()}>
            Refresh
          </Button>
          {snapshotPaths.size > 0 ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void checkpointAction('checkpoint.keep')}
              >
                Keep
              </Button>
              <Button size="sm" onClick={() => void checkpointAction('checkpoint.continue')}>
                Continue
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void checkpointAction('checkpoint.revertAll')}
              >
                Revert all
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {recoveryConflicts.length > 0 || (checkpoint.data?.conflicts.length ?? 0) > 0 ? (
        <div className="border-b border-warning/30 bg-warning/10 px-5 py-3 text-xs text-warning">
          <div className="font-medium">
            Some files were not reverted. No automatic overwrite occurred.
          </div>
          <ul className="mt-1 list-disc pl-4">
            {[...recoveryConflicts, ...(checkpoint.data?.conflicts ?? [])]
              .filter(
                (conflict, index, all) =>
                  all.findIndex((candidate) => candidate.path === conflict.path) === index,
              )
              .map((conflict) => (
                <li key={conflict.path}>
                  <code>{conflict.path}</code>: {conflict.reason}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {diff.data.truncated ? (
        <div className="border-b border-warning/30 bg-warning/10 px-5 py-2 text-xs text-warning">
          Diff output was truncated at 1 MB.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-auto border-r border-border bg-surface p-2">
          <div className="px-2 py-1 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
            Files
          </div>
          <div className="mt-1 space-y-0.5">
            {changedFiles.map((file) => {
              const snapshotPath = snapshotPaths.has(file.path)
                ? file.path
                : file.previousPath && snapshotPaths.has(file.previousPath)
                  ? file.previousPath
                  : undefined;
              return (
                <div
                  key={`${file.previousPath ?? ''}:${file.path}`}
                  className="flex items-center gap-1"
                >
                  <button
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-mono text-xs text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                    onClick={() => scrollToFile(file.path)}
                  >
                    <span className="mr-1.5 text-accent">{statusLabel(file.status)}</span>
                    {file.binary ? <span className="mr-1 text-warning">BIN</span> : null}
                    {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  </button>
                  {snapshotPath ? (
                    <Button variant="ghost" size="sm" onClick={() => void revertFile(snapshotPath)}>
                      Revert
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {changedFiles
            .filter((file) => file.binary)
            .map((file) => (
              <div
                key={`${file.previousPath ?? ''}:${file.path}`}
                className="m-4 rounded-lg border border-border bg-surface p-3 text-sm text-muted"
              >
                Binary file changed: <code className="text-foreground">{file.path}</code>. Contents
                cannot be displayed.
              </div>
            ))}
          <CodeView
            ref={codeViewRef}
            items={items}
            className="min-h-full bg-background text-sm"
            options={{
              theme: { light: 'github-light', dark: 'pierre-dark' },
              themeType: resolvedTheme,
              diffStyle,
              collapsedContextThreshold: compactContext ? 3 : 100,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function RecoveryPanel({
  checkpoint,
  isLoading,
  error,
  onKeep,
  onRevertAll,
  onRevertFile,
}: {
  checkpoint?: CheckpointReview;
  isLoading: boolean;
  error: unknown;
  onKeep: () => void;
  onRevertAll: () => void;
  onRevertFile: (path: string) => void;
}) {
  if (isLoading) return <DiffEmptyState title="Loading crash recovery checkpoint…" />;
  if (error) {
    return (
      <DiffEmptyState
        title={error instanceof Error ? error.message : 'Unable to load crash recovery checkpoint.'}
      />
    );
  }
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-auto p-6">
      <div>
        <h2 className="text-lg font-semibold">Recover interrupted agent changes</h2>
        <p className="mt-1 text-sm text-muted">
          This checkpoint survived an interrupted run. Reverting only restores files that still
          exactly match the agent&apos;s last recorded write; changed files are never overwritten.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-medium">Captured files</div>
        {checkpoint?.paths.length ? (
          <ul className="space-y-2">
            {checkpoint.paths.map((path) => (
              <li key={path} className="flex items-center justify-between gap-3 font-mono text-xs">
                <span className="truncate">{path}</span>
                <Button variant="ghost" size="sm" onClick={() => onRevertFile(path)}>
                  Revert
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No agent writes were captured before the interruption.
          </p>
        )}
      </div>
      {checkpoint?.conflicts.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-xs text-warning">
          Some files changed after the agent write and were not overwritten.
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onKeep}>
          Keep changes
        </Button>
        <Button variant="danger" onClick={onRevertAll}>
          Revert all safely
        </Button>
      </div>
    </div>
  );
}

function statusLabel(status: WorkingTreeDiff['files'][number]['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}

function DiffEmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="max-w-md text-sm text-muted">{title}</p>
      {action}
    </div>
  );
}
