import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * Trust the project if needed, create a session, and point the stream store at
 * it. Shared by the sidebar's and the home screen's "New task".
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const project = useWorkspaceStore((s) => s.project);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createTask(): Promise<SessionSummary | null> {
    if (!project) return null;
    setBusy(true);
    setError(null);
    try {
      const trusted = project.trusted
        ? project
        : await invoke<ProjectSummary>({
            method: 'project.setTrust',
            params: { projectId: project.id, trusted: true },
          });
      setProject(trusted);
      const created = await invoke<SessionSummary>({
        method: 'session.create',
        params: { projectId: trusted.id, title: 'New task' },
      });
      setSession(created);
      resetSessionView();
      setScope(trusted.id, created.id);
      await queryClient.invalidateQueries({ queryKey: ['session.list', trusted.id] });
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { createTask, busy, error };
}
