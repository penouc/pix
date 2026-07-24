import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionStore } from './session-store.js';

describe('SessionStore', () => {
  it('persists create/list/rename/archive across reload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'session-store-'));
    const file = path.join(dir, 'sessions.json');
    try {
      const store = new SessionStore(file);
      const created = await store.create({
        projectId: 'p1',
        title: 'One',
      });
      expect(created.id).toBeTruthy();
      expect(store.listByProject('p1')).toHaveLength(1);

      await store.rename(created.id, 'Two');
      expect(store.get(created.id)?.title).toBe('Two');

      await store.archive(created.id, true);
      expect(store.listByProject('p1')).toHaveLength(0);
      expect(store.listByProject('p1', true)).toHaveLength(1);

      const reloaded = new SessionStore(file);
      await reloaded.init();
      expect(reloaded.get(created.id)?.title).toBe('Two');
      expect(reloaded.get(created.id)?.archived).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
