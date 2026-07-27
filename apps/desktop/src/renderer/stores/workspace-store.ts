import type { ProjectSummary, SessionSummary, ThinkingLevel } from '@pi-desktop/protocol';
import { create } from 'zustand';

interface WorkspaceState {
  project: ProjectSummary | null;
  session: SessionSummary | null;
  /** `providerId/modelId` of the model the user picked in the title bar. */
  selectedModel: string;
  /** Reasoning depth for the next message when no session exists yet. */
  selectedThinkingLevel: ThinkingLevel;
  setProject: (project: ProjectSummary | null) => void;
  setSession: (session: SessionSummary | null) => void;
  setSelectedModel: (model: string) => void;
  setSelectedThinkingLevel: (level: ThinkingLevel) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  project: null,
  session: null,
  selectedModel: '',
  selectedThinkingLevel: 'medium',
  setProject: (project) => set({ project, session: null }),
  setSession: (session) => set({ session }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSelectedThinkingLevel: (selectedThinkingLevel) => set({ selectedThinkingLevel }),
}));
