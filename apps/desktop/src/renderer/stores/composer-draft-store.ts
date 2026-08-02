import { create } from 'zustand';

interface ComposerDraftState {
  /** One unsent composer value per existing task or per project's new-task screen. */
  drafts: Record<string, string>;
  setDraft: (scope: string, value: string) => void;
}

export function composerDraftScope(sessionId?: string, projectId?: string): string {
  if (sessionId) return `session:${sessionId}`;
  if (projectId) return `new:${projectId}`;
  return 'new:unscoped';
}

/**
 * Kept outside ChatPanel so navigating to Settings, Terminal, or another task
 * cannot destroy text the user has not sent or deleted.
 */
export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: {},
  setDraft: (scope, value) =>
    set((state) => {
      if (state.drafts[scope] === value) return state;
      if (!value) {
        const { [scope]: _removed, ...drafts } = state.drafts;
        return { drafts };
      }
      return { drafts: { ...state.drafts, [scope]: value } };
    }),
}));
