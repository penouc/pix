import type { ProjectSummary, SessionSummary, ThinkingLevel } from '@pi-desktop/protocol';
import { create } from 'zustand';

interface WorkspaceState {
  project: ProjectSummary | null;
  session: SessionSummary | null;
  /** `providerId/modelId` of the model the user picked in the title bar. */
  selectedModel: string;
  /** Reasoning depth for the next message when no session exists yet. */
  selectedThinkingLevel: ThinkingLevel;
  /**
   * Next blank-run create should be a Temporary chat (no user memory R/W).
   * Cleared once a session is created or a normal New task starts.
   */
  pendingTemporary: boolean;
  setProject: (project: ProjectSummary | null) => void;
  /** Switch project context without clearing the selected task. */
  setActiveProject: (project: ProjectSummary) => void;
  setSession: (session: SessionSummary | null) => void;
  setSelectedModel: (model: string) => void;
  setSelectedThinkingLevel: (level: ThinkingLevel) => void;
  setPendingTemporary: (temporary: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  project: null,
  session: null,
  selectedModel: '',
  selectedThinkingLevel: 'medium',
  pendingTemporary: false,
  setProject: (project) => set({ project, session: null, pendingTemporary: false }),
  /** Switch project context without clearing the selected task. */
  setActiveProject: (project) => set({ project }),
  setSession: (session) => set({ session, ...(session ? { pendingTemporary: false } : {}) }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSelectedThinkingLevel: (selectedThinkingLevel) => set({ selectedThinkingLevel }),
  setPendingTemporary: (pendingTemporary) => set({ pendingTemporary }),
}));
