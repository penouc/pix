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

/**
 * Surface a folder in history.nav without reshuffling the list.
 * New projects prepend; existing rows update in place.
 */
export function upsertOpenedProjectInNav(
  queryClient: QueryClient,
  opened: ProjectSummary,
): void {
  const stamp = opened.lastOpenedAt || Date.now();
  queryClient.setQueryData<HistoryNav>(['history.nav'], (prev) => {
    const next: HistoryProjectNav = {
      path: opened.path,
      name: opened.name,
      count: 0,
      lastActive: stamp,
      archived: false,
      pixProjectId: opened.id,
    };
    if (!prev) {
      return { agents: [], projects: [next], total: 0 };
    }
    const existing = prev.projects.find((item) => projectMatches(item, opened));
    if (existing) {
      return {
        ...prev,
        projects: prev.projects.map((item) =>
          projectMatches(item, opened)
            ? {
                ...item,
                path: item.path || opened.path,
                name: opened.name || item.name,
                archived: false,
                pixProjectId: opened.id,
              }
            : item,
        ),
      };
    }
    return {
      ...prev,
      projects: [next, ...prev.projects],
    };
  });
}
