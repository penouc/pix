import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';
import { create } from 'zustand';

interface WorkspaceState {
  project: ProjectSummary | null;
  session: SessionSummary | null;
  /** `providerId/modelId` of the model the user picked in the title bar. */
  selectedModel: string;
  setProject: (project: ProjectSummary | null) => void;
  setSession: (session: SessionSummary | null) => void;
  setSelectedModel: (model: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  project: null,
  session: null,
  selectedModel: '',
  setProject: (project) => set({ project, session: null }),
  setSession: (session) => set({ session }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
}));
