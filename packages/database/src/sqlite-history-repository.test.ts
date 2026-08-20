import { describe, expect, it } from 'vitest';

import { openDatabase } from './sqlite-connection.js';
import { SqliteHistoryRepository } from './sqlite-history-repository.js';

describe('SqliteHistoryRepository', () => {
  it('writes, lists, favorites, and tombstones sessions', () => {
    const db = openDatabase(':memory:');
    const history = new SqliteHistoryRepository(db);

    history.writeSession({
      meta: {
        key: 'claude-code:abc',
        agent: 'claude-code',
        nativeId: 'abc',
        title: 'Fix the button',
        projectPath: '/tmp/demo',
        projectName: 'demo',
        filePath: '/tmp/demo/session.jsonl',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 2,
        model: 'claude',
        tokensUsed: 10,
        favorite: false,
        origin: 'external',
      },
      fileMtime: 2000,
      fileSize: 100,
      units: [
        { seq: 0, role: 'user', kind: 'text', text: 'hello' },
        { seq: 1, role: 'assistant', kind: 'text', text: 'world' },
      ],
    });

    const listed = history.list({ agent: 'claude-code' });
    expect(listed.total).toBe(1);
    expect(listed.sessions[0]?.title).toBe('Fix the button');
    expect(history.listMessages('claude-code:abc')).toHaveLength(2);

    history.setFavorite('claude-code:abc', true);
    expect(history.get('claude-code:abc')?.favorite).toBe(true);

    const byTitle = history.list({ titleQuery: 'button' });
    expect(byTitle.total).toBe(1);

    history.removeSession('claude-code:abc', true);
    expect(history.list().total).toBe(0);
    expect(history.isTombstoned('/tmp/demo/session.jsonl')).toBe(true);

    history.setProjectArchived('/tmp/demo', true, 'demo');
    expect(history.isProjectArchived('/tmp/demo')).toBe(true);
    expect(history.listArchivedProjects()).toEqual([
      expect.objectContaining({ path: '/tmp/demo', name: 'demo' }),
    ]);
    history.setProjectArchived('/tmp/demo', false);
    expect(history.isProjectArchived('/tmp/demo')).toBe(false);

    // Path variants collapse to one canonical project key.
    history.writeSession({
      meta: {
        key: 'codex:a',
        agent: 'codex',
        nativeId: 'a',
        title: 'A',
        projectPath: '/tmp/merge-demo/',
        projectName: 'merge-demo',
        filePath: '/tmp/a.jsonl',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        favorite: false,
        origin: 'external',
      },
      fileMtime: 2,
      fileSize: 1,
      units: [],
    });
    history.writeSession({
      meta: {
        key: 'claude-code:b',
        agent: 'claude-code',
        nativeId: 'b',
        title: 'B',
        projectPath: '/tmp/merge-demo',
        projectName: 'merge-demo',
        filePath: '/tmp/b.jsonl',
        createdAt: 1,
        updatedAt: 3,
        messageCount: 0,
        favorite: false,
        origin: 'external',
      },
      fileMtime: 3,
      fileSize: 1,
      units: [],
    });
    expect(history.canonicalizeProjectPaths()).toBeGreaterThanOrEqual(1);
    const merged = history.projectCounts().filter((p) => p.path.includes('merge-demo'));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.count).toBe(2);

    // Key migration: same file_path, new key replaces the old row.
    history.writeSession({
      meta: {
        key: 'codex:new-id',
        agent: 'codex',
        nativeId: 'new-id',
        title: 'Fixed title',
        projectPath: '/tmp/merge-demo',
        projectName: 'merge-demo',
        filePath: '/tmp/a.jsonl',
        createdAt: 1,
        updatedAt: 4,
        messageCount: 1,
        favorite: false,
        origin: 'external',
      },
      fileMtime: 4,
      fileSize: 2,
      units: [{ seq: 0, role: 'user', kind: 'text', text: 'hello world' }],
    });
    expect(history.get('codex:a')).toBeNull();
    expect(history.get('codex:new-id')?.title).toBe('Fixed title');
    expect(history.listMessages('codex:new-id')).toHaveLength(1);

    db.close();
  });
});
