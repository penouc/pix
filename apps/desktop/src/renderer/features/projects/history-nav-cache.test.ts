import { describe, expect, it } from 'vitest';

import { activeSidebarProjects, upsertOpenedProjectInNav } from './history-nav-cache';

describe('history-nav-cache', () => {
  it('limits active sidebar projects', () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({
      path: `/tmp/p-${index}`,
      name: `p-${index}`,
      count: 0,
      lastActive: index,
      archived: false,
    }));

    expect(activeSidebarProjects(projects, 80)).toHaveLength(80);
  });

  it('optimistically inserts an opened folder into history.nav', () => {
    const cache = new Map<string, unknown>();
    const queryClient = {
      setQueryData: (key: unknown[], updater: (prev: unknown) => unknown) => {
        cache.set(JSON.stringify(key), updater(cache.get(JSON.stringify(key))));
      },
    };

    upsertOpenedProjectInNav(queryClient as never, {
      id: 'proj-1',
      path: '/tmp/demo',
      name: 'demo',
      trusted: true,
      isGit: false,
      lastOpenedAt: 100,
    });

    const nav = cache.get(JSON.stringify(['history.nav'])) as {
      projects: Array<{ path: string; pixProjectId?: string }>;
    };
    expect(nav.projects[0]?.path).toBe('/tmp/demo');
    expect(nav.projects[0]?.pixProjectId).toBe('proj-1');
  });
});
