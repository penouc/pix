import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, File, FolderOpen, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { IndexProjectStatus } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface Children {
  directories: string[];
  files: string[];
}

/**
 * The project's files, read from the workspace index rather than the filesystem.
 *
 * That is the point: the index already respects `.gitignore`, is already gated
 * on workspace trust, and is already what ⌘K searches — so the tree cannot show
 * you a file that search denies, or a `node_modules` the agent would never read.
 * The cost is that a brand-new file appears after the next refresh, which is why
 * Refresh is here and says what it does.
 */
export function FileTree({ onInsertPath }: { onInsertPath: (path: string) => void }) {
  const project = useWorkspaceStore((s) => s.project);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (!project) return;
    setRefreshing(true);
    try {
      // Incremental: unchanged files are not re-read.
      await invoke<IndexProjectStatus[]>({
        method: 'index.rebuild',
        params: { projectId: project.id, force: false },
      });
      await queryClient.invalidateQueries({ queryKey: ['index.tree'] });
    } finally {
      setRefreshing(false);
    }
  }

  if (!project) {
    return <Empty>Open a project to browse its files.</Empty>;
  }
  if (!project.trusted) {
    return <Empty>Trust this project to browse its files.</Empty>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{project.name}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing}
          title="Re-index changed files"
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <Directory projectId={project.id} prefix="" depth={0} onInsertPath={onInsertPath} />
      </div>
      <p className="flex-none border-t border-border px-3 py-2 text-[11px] leading-snug text-muted">
        Click a file to reference it in the composer.
      </p>
    </div>
  );
}

/** One expanded directory level. Children are fetched only once opened. */
function Directory({
  projectId,
  prefix,
  depth,
  onInsertPath,
}: {
  projectId: string;
  prefix: string;
  depth: number;
  onInsertPath: (path: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const children = useQuery({
    queryKey: ['index.tree', projectId, prefix],
    queryFn: () => invoke<Children>({ method: 'index.tree', params: { projectId, prefix } }),
  });

  if (children.isLoading) {
    return <Row depth={depth} muted label="loading…" />;
  }

  const data = children.data;
  if (!data || (!data.directories.length && !data.files.length)) {
    return depth === 0 ? (
      <Empty>
        Nothing indexed yet. Refresh above, or open a project with tracked files in it.
      </Empty>
    ) : (
      <Row depth={depth} muted label="empty" />
    );
  }

  return (
    <>
      {data.directories.map((name) => {
        const path = prefix ? `${prefix}/${name}` : name;
        const expanded = open.has(name);
        return (
          <div key={`dir:${name}`}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent py-[3px] pr-3 text-left text-[12.5px] hover:bg-foreground/[0.05]"
              style={{ paddingLeft: 10 + depth * 12 }}
              onClick={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                })
              }
            >
              <ChevronRight
                className={cn('h-3 w-3 flex-none text-muted transition-transform', expanded && 'rotate-90')}
              />
              <FolderOpen className="h-3.5 w-3.5 flex-none text-accent-2-400" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
            </button>
            {expanded ? (
              <Directory
                projectId={projectId}
                prefix={path}
                depth={depth + 1}
                onInsertPath={onInsertPath}
              />
            ) : null}
          </div>
        );
      })}

      {data.files.map((name) => {
        const path = prefix ? `${prefix}/${name}` : name;
        return (
          <button
            key={`file:${name}`}
            type="button"
            title={path}
            className="flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent py-[3px] pr-3 text-left text-[12.5px] hover:bg-foreground/[0.05]"
            style={{ paddingLeft: 10 + depth * 12 + 12 }}
            onClick={() => onInsertPath(path)}
          >
            <File className="h-3.5 w-3.5 flex-none text-muted" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </button>
        );
      })}
    </>
  );
}

function Row({ depth, label, muted }: { depth: number; label: string; muted?: boolean }) {
  return (
    <div
      className={cn('py-[3px] pr-3 text-[12px]', muted && 'text-muted')}
      style={{ paddingLeft: 10 + depth * 12 + 12 }}
    >
      {label}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3.5 py-6 text-center text-[12px] leading-relaxed text-muted">{children}</div>;
}
