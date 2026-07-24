import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { SqliteSessionRepository } from './sqlite-session-repository.js';

describe('SqliteSessionRepository', () => {
  let dir: string;
  let repo: SqliteSessionRepository;

  afterEach(async () => {
    repo?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function createRepo() {
    dir = await mkdtemp(path.join(tmpdir(), 'pi-db-'));
    repo = new SqliteSessionRepository(path.join(dir, 'desktop.sqlite'));
    await repo.init();
    return repo;
  }

  it('creates, lists, renames, archives, and reloads', async () => {
    const r = await createRepo();
    const created = await r.create({ projectId: 'p1', title: 'One' });
    expect(created.id).toBeTruthy();
    expect(r.listByProject('p1')).toHaveLength(1);

    await r.rename(created.id, 'Two');
    expect(r.get(created.id)?.title).toBe('Two');

    await r.touch(created.id);
    const afterTouch = r.get(created.id);
    expect(afterTouch?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await r.archive(created.id, true);
    expect(r.listByProject('p1')).toHaveLength(0);
    expect(r.listByProject('p1', true)).toHaveLength(1);

    r.close();
    const reloaded = new SqliteSessionRepository(path.join(dir, 'desktop.sqlite'));
    await reloaded.init();
    expect(reloaded.get(created.id)?.title).toBe('Two');
    expect(reloaded.get(created.id)?.archived).toBe(true);
    reloaded.close();
    // prevent afterEach double-close issues
    repo = reloaded;
  });

  it('imports legacy JSON sessions once', async () => {
    const r = await createRepo();
    const jsonPath = path.join(dir, 'sessions.json');
    await writeFile(
      jsonPath,
      JSON.stringify({
        sessions: [
          {
            id: 's-json-1',
            projectId: 'p2',
            title: 'From JSON',
            createdAt: 100,
            updatedAt: 200,
            archived: false,
          },
        ],
      }),
      'utf8',
    );

    const n1 = await r.importFromJsonFile(jsonPath);
    expect(n1).toBe(1);
    expect(r.get('s-json-1')?.title).toBe('From JSON');

    const n2 = await r.importFromJsonFile(jsonPath);
    expect(n2).toBe(0);
  });

  it('upserts via put', async () => {
    const r = await createRepo();
    await r.put({
      id: 'fixed-id',
      projectId: 'p3',
      title: 'A',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    await r.put({
      id: 'fixed-id',
      projectId: 'p3',
      title: 'B',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
    });
    expect(r.get('fixed-id')?.title).toBe('B');
    expect(r.listByProject('p3')).toHaveLength(1);
  });
});
