import type { QueryClient } from '@tanstack/react-query';

import type { HistoryNav, HistoryProjectNav, ProjectSummary } from '@pi-desktop/protocol';

function projectMatches(
  item: HistoryProjectNav,
  opened: Pick<ProjectSummary, 'id' | 'path'>,
): boolean {
  return item.pixProjectId === opened.id || item.path === opened.path;
}

/** Active Projects rows from the single history.nav source. */
export function activeSidebarProjects(
  projects: HistoryProjectNav[] | undefined,
  limit = 80,
): HistoryProjectNav[] {
  return (projects ?? []).filter((item) => !item.archived).slice(0, limit);
}

/** Immediately surface a just-opened folder in history.nav (Projects sidebar source). */
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
    const existing = prev.projects.find((item) => projectMatches(item, opened));
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
      projects: [
        merged,
        ...prev.projects.filter((item) => !projectMatches(item, opened)),
      ],
    };
  });
}
