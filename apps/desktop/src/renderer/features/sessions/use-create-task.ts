import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * Trust the project if needed, create a session, and point the stream store at
 * it.
 *
 * `into` exists because the caller sometimes opens a project and creates a task
 * in it in the same tick — the store selector below would still hold the old
 * value at that point, and the task would land in the previous project.
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const project = useWorkspaceStore((s) => s.project);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const selectedThinkingLevel = useWorkspaceStore((s) => s.selectedThinkingLevel);
  const setProject = useWorkspaceStore((s) => s.setProject);
  const setSession = useWorkspaceStore((s) => s.setSession);
  const resetSessionView = useAgentStreamStore((s) => s.resetSessionView);
  const setScope = useAgentStreamStore((s) => s.setScope);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createTask(into?: ProjectSummary): Promise<SessionSummary | null> {
    const target = into ?? project;
    if (!target) return null;
    setBusy(true);
    setError(null);
    try {
      const trusted = target.trusted
        ? target
        : await invoke<ProjectSummary>({
            method: 'project.setTrust',
            params: { projectId: target.id, trusted: true },
          });
      setProject(trusted);
      const created = await invoke<SessionSummary>({
        method: 'session.create',
        params: { projectId: trusted.id, title: 'New task' },
      });
      /*
       * Apply the model chosen in the composer. The picker can be used before any
       * session exists (the unstarted-task screen), where `agent.setModel` has
       * nothing to target — so without this the first run of a new task silently
       * ignored the model you had just selected.
       */
      if (selectedModel.includes('/')) {
        const [providerId, ...rest] = selectedModel.split('/');
        const modelId = rest.join('/');
        if (providerId && modelId) {
          await invoke({
            method: 'agent.setModel',
            params: { sessionId: created.id, model: { providerId, modelId } },
          }).catch((err) => console.error('[createTask] setModel failed', err));
        }
      }
      await invoke({
        method: 'agent.setThinkingLevel',
        params: { sessionId: created.id, level: selectedThinkingLevel },
      }).catch((err) => console.error('[createTask] setThinkingLevel failed', err));
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
