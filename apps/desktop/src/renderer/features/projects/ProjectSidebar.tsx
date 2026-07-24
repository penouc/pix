import { FolderGit2, FolderOpen, Plus } from 'lucide-react';
import { useState } from 'react';

import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function ProjectSidebar() {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const [pathInput, setPathInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openProject() {
    const path = pathInput.trim() || processCwdFallback();
    setBusy(true);
    setError(null);
    try {
      const opened = await invoke<ProjectSummary>({
        method: 'project.open',
        params: { path },
      });
      setProject(opened);
      resetSessionView();
      setPathInput(opened.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await invoke<SessionSummary>({
        method: 'session.create',
        params: {
          projectId: project.id,
          title: 'Coding session',
          model: { providerId: 'fake', modelId: 'fake-demo' },
        },
      });
      setSession(created);
      resetSessionView();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Pi Agent
        </div>
        <div className="mt-1 text-sm text-foreground">Desktop Workbench</div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <section className="space-y-2">
          <div className="text-xs font-medium text-muted">Project path</div>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            placeholder="/path/to/git-project"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openProject();
            }}
          />
          <Button className="w-full" variant="secondary" disabled={busy} onClick={() => void openProject()}>
            <FolderOpen className="h-4 w-4" />
            Open project
          </Button>
        </section>

        {project ? (
          <section className="rounded-xl border border-border bg-surface-raised p-3">
            <div className="flex items-start gap-2">
              <FolderGit2 className="mt-0.5 h-4 w-4 text-accent" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{project.name}</div>
                <div className="mt-0.5 truncate text-xs text-muted" title={project.path}>
                  {project.path}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>{project.isGit ? 'Git' : 'No Git'}</Badge>
                  <Badge className={project.trusted ? 'text-success' : 'text-warning'}>
                    {project.trusted ? 'Trusted' : 'Untrusted'}
                  </Badge>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <div className="text-xs font-medium text-muted">Session</div>
          {session ? (
            <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <div className="font-medium">{session.title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{session.id.slice(0, 8)}…</div>
            </div>
          ) : (
            <div className="text-xs text-muted">No active session</div>
          )}
          <Button className="w-full" disabled={!project || busy} onClick={() => void createSession()}>
            <Plus className="h-4 w-4" />
            New session
          </Button>
        </section>

        {error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function processCwdFallback(): string {
  // Renderer has no process.cwd; default to empty and let Main validate.
  return '';
}
