import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { WorkingTreeDiff } from '@pi-desktop/protocol';

import { Segmented } from '@/components/ui/segmented';
import { invoke } from '@/lib/ipc';
import {
  fileBadgeStyle,
  fileKindBadge,
  formatCost,
  formatDuration,
  formatInteger,
  NOT_REPORTED,
} from '@/lib/status';
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

/**
 * The design's 336px review rail: what changed and how the run went.
 */
export function ReviewPanel({
  onOpenFullDiff,
}: {
  onOpenFullDiff: (path?: string) => void;
}) {
  const project = useWorkspaceStore((s) => s.project);
  const diffStyle = useUiPrefsStore((s) => s.diffStyle);
  const setPref = useUiPrefsStore((s) => s.set);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const status = useAgentStreamStore((s) => s.status);
  const startedAt = useAgentStreamStore((s) => s.startedAt);
  const usage = useAgentStreamStore((s) => s.usage);
  const tools = useAgentStreamStore((s) => s.tools);
  const eventModel = useAgentStreamStore((s) => s.model);
  const [conflicts, setConflicts] = useState<RecoveryConflict[]>([]);
  const [busy, setBusy] = useState(false);

  const diff = useQuery({
    queryKey: ['git.workingTreeDiff', project?.id],
    enabled: Boolean(project?.trusted && project.isGit),
    queryFn: () =>
      invoke<WorkingTreeDiff>({
        method: 'git.getWorkingTreeDiff',
        params: { projectId: project!.id },
      }),
  });

  const checkpoint = useQuery({
    queryKey: ['checkpoint.review', activeRunId],
    enabled: Boolean(activeRunId),
    retry: false,
    queryFn: () =>
      invoke<CheckpointReview>({ method: 'checkpoint.review', params: { runId: activeRunId! } }),
  });

  const files = diff.data?.files ?? [];
  const snapshotPaths = new Set(checkpoint.data?.paths ?? []);

  async function revertFile(path: string) {
    if (!activeRunId) return;
    setBusy(true);
    try {
      const result = await invoke<RecoveryResult>({
        method: 'checkpoint.revertFile',
        params: { runId: activeRunId, path },
      });
      setConflicts(result.conflicts);
      await checkpoint.refetch();
      await diff.refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const model = eventModel
    ? `${eventModel.providerId}/${eventModel.modelId}`
    : selectedModel || NOT_REPORTED;

  const runRows: Array<[string, string]> = [
    ['Status', status],
    ['Elapsed', formatDuration(startedAt)],
    ['Tools', String(tools.length)],
    ['Input tokens', formatInteger(usage?.inputTokens)],
    ['Output tokens', formatInteger(usage?.outputTokens)],
    ['Cost', formatCost(usage?.costUsd)],
    ['Model', model],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3.5 pb-2.5">
        <h4 className="mb-0.5">Review changes</h4>
        <div className="text-[11.5px] text-muted">
          {files.length} changed {files.length === 1 ? 'file' : 'files'} · compared with HEAD
        </div>
        <Segmented
          className="mt-2.5"
          size="sm"
          aria-label="Diff style"
          options={[
            { value: 'unified', label: 'Unified' },
            { value: 'split', label: 'Split' },
          ]}
          value={diffStyle}
          onChange={(value) => setPref('diffStyle', value)}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-2.5 pb-3">
        {files.map((file) => {
          const badge = fileKindBadge[file.status] ?? fileKindBadge.modified!;
          const restorable = snapshotPaths.has(file.path);
          return (
            <div
              key={file.path}
              className="group flex items-center gap-2 rounded-[16px] px-2.5 py-2 font-mono text-[11.5px] hover:bg-foreground/[0.06]"
            >
              <span style={fileBadgeStyle(badge.background)}>{badge.letter}</span>
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer truncate text-left"
                title={file.path}
                onClick={() => onOpenFullDiff(file.path)}
              >
                {file.path}
              </button>
              {restorable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revertFile(file.path)}
                  className="hidden cursor-pointer rounded-full px-2 py-0.5 text-[11px] text-accent-700 group-hover:block hover:bg-accent/10 disabled:opacity-40"
                  title="Restore this file from the run's snapshot"
                >
                  Revert
                </button>
              ) : null}
            </div>
          );
        })}

        {!files.length ? (
          <div className="px-2.5 py-3 text-[11.5px] text-muted">
            {project?.isGit
              ? project.trusted
                ? 'Nothing changed in the working tree.'
                : 'Trust the project to read its working tree.'
              : 'Not a Git project.'}
          </div>
        ) : null}

        {conflicts.length ? (
          <div className="mt-3 rounded-[18px] border border-accent/35 bg-accent-100 px-3.5 py-3">
            <div className="mb-1.5 text-[12.5px] font-bold text-accent-900">
              Not overwritten ({conflicts.length})
            </div>
            <div className="flex flex-col gap-1">
              {conflicts.map((conflict) => (
                <div key={conflict.path} className="text-[11px] leading-snug text-accent-900">
                  <span className="font-mono">{conflict.path}</span> — {conflict.reason}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3.5 px-2.5">
          <h6 className="mb-2 opacity-55">Run &amp; models</h6>
          <div className="flex flex-col gap-[7px]">
            {runRows.map(([label, value]) => (
              <div key={label} className="flex items-center gap-2.5 text-xs">
                <span className="flex-1 text-muted">{label}</span>
                <span className="max-w-[170px] truncate font-mono text-[11.5px]" title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3.5 rounded-[20px] bg-background/70 px-3.5 py-3">
          <div className="mb-1.5 text-[12.5px] font-bold">Checkpoint</div>
          <div className="text-[11.5px] leading-normal text-muted">
            Revert only restores files that still match the agent&apos;s last recorded write. Files
            you changed since are never overwritten.
          </div>
        </div>
      </div>
    </div>
  );
}
