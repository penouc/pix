import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqliteDatabase } from './sqlite-connection.js';
import { openDatabase } from './sqlite-connection.js';
import { SqliteProjectRepository } from './sqlite-project-repository.js';
import { SqliteSessionRepository } from './sqlite-session-repository.js';
import { SqliteTodoRepository } from './sqlite-todo-repository.js';

describe('SqliteTodoRepository', () => {
  let db: SqliteDatabase;
  let repo: SqliteTodoRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const projects = new SqliteProjectRepository(db);
    void projects.put({
      id: 'p1',
      path: '/tmp/p1',
      name: 'p1',
      trusted: true,
      isGit: false,
      lastOpenedAt: 1,
    });
    const sessions = new SqliteSessionRepository(db);
    void sessions.put({
      id: 's1',
      projectId: 'p1',
      title: 'T',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    void sessions.put({
      id: 's2',
      projectId: 'p1',
      title: 'T2',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    repo = new SqliteTodoRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('loads an empty list for a session that never saved todos', () => {
    expect(repo.load('s1')).toEqual([]);
  });

  it('round-trips a checklist', () => {
    const items = [
      { id: 't1', text: 'Inspect the code', status: 'in_progress' as const },
      { id: 't2', text: 'Write the test', status: 'pending' as const },
    ];
    repo.save('s1', items);
    expect(repo.load('s1')).toEqual(items);
  });

  it('replaces the checklist on save', () => {
    repo.save('s1', [{ id: 't1', text: 'First', status: 'pending' }]);
    const next = [
      { id: 't1', text: 'First', status: 'completed' as const },
      { id: 't2', text: 'Second', status: 'pending' as const },
    ];
    repo.save('s1', next);
    expect(repo.load('s1')).toEqual(next);
  });

  it('keeps sessions isolated', () => {
    repo.save('s1', [{ id: 'a', text: 'A', status: 'pending' }]);
    repo.save('s2', [{ id: 'b', text: 'B', status: 'pending' }]);
    expect(repo.load('s1').map((i) => i.text)).toEqual(['A']);
    expect(repo.load('s2').map((i) => i.text)).toEqual(['B']);
  });

  it('returns an empty list for corrupt rows instead of crashing', () => {
    db.prepare(
      `INSERT INTO session_todos (session_id, items_json, updated_at) VALUES (?, ?, ?)`,
    ).run('s1', '{not valid json', Date.now());
    expect(repo.load('s1')).toEqual([]);
  });
});
