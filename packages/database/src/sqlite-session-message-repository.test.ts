import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './sqlite-connection.js';
import { SqliteProjectRepository } from './sqlite-project-repository.js';
import { SqliteSessionMessageRepository } from './sqlite-session-message-repository.js';
import { SqliteSessionRepository } from './sqlite-session-repository.js';

describe('SqliteSessionMessageRepository', () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  afterEach(() => {
    db?.close();
    if (dbPath && dbPath !== ':memory:') {
      // openDatabase for temp files is not used here; memory only.
    }
  });

  async function setup() {
    dbPath = ':memory:';
    db = openDatabase(dbPath);
    const projects = new SqliteProjectRepository(db);
    await projects.put({
      id: 'p1',
      path: '/tmp/p1',
      name: 'p1',
      trusted: true,
      isGit: false,
      lastOpenedAt: 1,
    });
    const sessions = new SqliteSessionRepository(db);
    await sessions.put({
      id: 's1',
      projectId: 'p1',
      title: 'T',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    return new SqliteSessionMessageRepository(db);
  }

  it('stores and lists messages in order', async () => {
    const repo = await setup();
    await repo.append({ id: 'm1', sessionId: 's1', role: 'user', text: 'hello' });
    await repo.append({ id: 'm2', sessionId: 's1', role: 'assistant', text: 'hi there' });
    expect(repo.list('s1')).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
    ]);
  });

  it('updates assistant text on duplicate message id', async () => {
    const repo = await setup();
    await repo.append({ id: 'm1', sessionId: 's1', role: 'assistant', text: 'part' });
    await repo.append({ id: 'm1', sessionId: 's1', role: 'assistant', text: 'full reply' });
    expect(repo.list('s1')).toEqual([{ role: 'assistant', text: 'full reply' }]);
  });

  it('backfills only when empty', async () => {
    const repo = await setup();
    const count = await repo.backfill('s1', [
      { role: 'user', text: 'old question' },
      { role: 'assistant', text: 'old answer' },
    ]);
    expect(count).toBe(2);
    expect(repo.list('s1').length).toBe(2);
    const again = await repo.backfill('s1', [{ role: 'user', text: 'ignored' }]);
    expect(again).toBe(0);
  });
});
