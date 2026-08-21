import type { QueryClient } from '@tanstack/react-query';

import type { HistoryNav, HistoryProjectNav, ProjectSummary } from '@pi-desktop/protocol';

/** Immediately surface a just-opened folder in the Projects sidebar. */
export function upsertOpenedProjectInNav(
  queryClient: QueryClient,
  opened: ProjectSummary,
): void {
  const now = Date.now();
  queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
    const next: HistoryProjectNav = {
      path: opened.path,
      name: opened.name,
      count: 0,
      lastActive: now,
      archived: false,
      pixProjectId: opened.id,
    };
    if (!prev) {
      return { agents: [], projects: [next], total: 0 };
    }
    const match = (p: HistoryProjectNav) =>
      p.path === opened.path || p.pixProjectId === opened.id;
    const existing = prev.projects.find(match);
    const merged: HistoryProjectNav = existing
      ? {
          ...existing,
          path: existing.path || opened.path,
          name: opened.name || existing.name,
          lastActive: now,
          archived: false,
          pixProjectId: opened.id,
        }
      : next;
    return {
      ...prev,
      projects: [merged, ...prev.projects.filter((p) => !match(p))],
    };
  });
}
