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
    await repo.append({
      id: 'm1',
      sessionId: 's1',
      entry: { kind: 'message', role: 'user', text: 'hello' },
    });
    await repo.append({
      id: 'm2',
      sessionId: 's1',
      entry: { kind: 'message', role: 'assistant', text: 'hi there' },
    });
    expect(repo.list('s1')).toEqual([
      { kind: 'message', role: 'user', text: 'hello' },
      { kind: 'message', role: 'assistant', text: 'hi there' },
    ]);
  });

  it('persists image attachment metadata without image bytes', async () => {
    const repo = await setup();
    await repo.append({
      id: 'm-image',
      sessionId: 's1',
      entry: {
        kind: 'message',
        role: 'user',
        text: '',
        images: [{ name: 'screen.png', mimeType: 'image/png', size: 1234 }],
      },
    });
    expect(repo.list('s1')).toEqual([
      {
        kind: 'message',
        role: 'user',
        text: '',
        images: [{ name: 'screen.png', mimeType: 'image/png', size: 1234 }],
      },
    ]);
  });

  it('updates assistant text on duplicate message id', async () => {
    const repo = await setup();
    await repo.append({
      id: 'm1',
      sessionId: 's1',
      entry: { kind: 'message', role: 'assistant', text: 'part' },
    });
    await repo.append({
      id: 'm1',
      sessionId: 's1',
      entry: { kind: 'message', role: 'assistant', text: 'full reply' },
    });
    expect(repo.list('s1')).toEqual([{ kind: 'message', role: 'assistant', text: 'full reply' }]);
  });

  it('persists thinking and tool cards and merges tool completion', async () => {
    const repo = await setup();
    await repo.append({
      id: 'u1',
      sessionId: 's1',
      entry: { kind: 'message', role: 'user', text: 'fix it' },
    });
    await repo.append({
      id: 'think-1',
      sessionId: 's1',
      entry: { kind: 'thinking', id: 'msg-1', content: 'I should read the file first' },
    });
    await repo.append({
      id: 'tool-1',
      sessionId: 's1',
      entry: {
        kind: 'tool',
        id: 'tool-1',
        toolName: 'read',
        inputSummary: 'read: README.md',
        status: 'running',
      },
    });
    await repo.append({
      id: 'tool-1',
      sessionId: 's1',
      entry: {
        kind: 'tool',
        id: 'tool-1',
        toolName: 'read',
        inputSummary: '',
        outputSummary: '# Title',
        ok: true,
        status: 'completed',
      },
    });
    await repo.append({
      id: 'a1',
      sessionId: 's1',
      entry: { kind: 'message', role: 'assistant', text: 'Done.' },
    });

    expect(repo.list('s1')).toEqual([
      { kind: 'message', role: 'user', text: 'fix it' },
      { kind: 'thinking', id: 'think-1', content: 'I should read the file first' },
      {
        kind: 'tool',
        id: 'tool-1',
        toolName: 'read',
        inputSummary: 'read: README.md',
        outputSummary: '# Title',
        ok: true,
        status: 'completed',
      },
      { kind: 'message', role: 'assistant', text: 'Done.' },
    ]);
  });

  it('backfills only when empty', async () => {
    const repo = await setup();
    const count = await repo.backfill('s1', [
      { kind: 'message', role: 'user', text: 'old question' },
      { kind: 'message', role: 'assistant', text: 'old answer' },
    ]);
    expect(count).toBe(2);
    expect(repo.list('s1').length).toBe(2);
    const again = await repo.backfill('s1', [{ kind: 'message', role: 'user', text: 'ignored' }]);
    expect(again).toBe(0);
  });

  it('deletes a session transcript so the Pi branch becomes the source again', async () => {
    const repo = await setup();
    await repo.backfill('s1', [
      { kind: 'message', role: 'user', text: 'keep me' },
      { kind: 'message', role: 'assistant', text: 'abandoned branch' },
    ]);
    expect(repo.list('s1')).toHaveLength(2);

    await repo.deleteBySession('s1');
    expect(repo.list('s1')).toHaveLength(0);
    // The write must be a full wipe: a backfill after the fork restores only
    // what the rewound Pi session reports.
    await repo.backfill('s1', [{ kind: 'message', role: 'user', text: 'rewound prompt' }]);
    expect(repo.list('s1')).toHaveLength(1);
  });
});
