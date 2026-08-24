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

  it('optimistically inserts a new folder at the front of history.nav', () => {
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

  it('updates an existing project in place without reordering', () => {
    const cache = new Map<string, unknown>();
    cache.set(
      JSON.stringify(['history.nav']),
      {
        agents: [],
        total: 0,
        projects: [
          {
            path: '/tmp/first',
            name: 'first',
            count: 1,
            lastActive: 50,
            archived: false,
            pixProjectId: 'proj-a',
          },
          {
            path: '/tmp/demo',
            name: 'old-name',
            count: 2,
            lastActive: 40,
            archived: false,
            pixProjectId: 'proj-1',
          },
        ],
      },
    );
    const queryClient = {
      setQueryData: (key: unknown[], updater: (prev: unknown) => unknown) => {
        const encoded = JSON.stringify(key);
        cache.set(encoded, updater(cache.get(encoded)));
      },
    };

    upsertOpenedProjectInNav(queryClient as never, {
      id: 'proj-1',
      path: '/tmp/demo',
      name: 'demo',
      trusted: true,
      isGit: false,
      lastOpenedAt: 40,
    });

    const nav = cache.get(JSON.stringify(['history.nav'])) as {
      projects: Array<{ path: string; name: string; lastActive: number }>;
    };
    expect(nav.projects.map((p) => p.path)).toEqual(['/tmp/first', '/tmp/demo']);
    expect(nav.projects[1]?.name).toBe('demo');
    expect(nav.projects[1]?.lastActive).toBe(40);
  });
});
