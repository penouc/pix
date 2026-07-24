import type { ProjectSummary, SessionSummary } from '@pi-desktop/protocol';
import { create } from 'zustand';

interface WorkspaceState {
  project: ProjectSummary | null;
  session: SessionSummary | null;
  setProject: (project: ProjectSummary | null) => void;
  setSession: (session: SessionSummary | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  project: null,
  session: null,
  setProject: (project) => set({ project, session: null }),
  setSession: (session) => set({ session }),
}));
