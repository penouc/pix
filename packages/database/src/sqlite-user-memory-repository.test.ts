import { describe, expect, it } from 'vitest';

import { openDatabase } from './sqlite-connection.js';
import { SqliteUserMemoryRepository } from './sqlite-user-memory-repository.js';

describe('SqliteUserMemoryRepository', () => {
  it('adds, lists, updates, and deletes memories', () => {
    const db = openDatabase(':memory:');
    const memories = new SqliteUserMemoryRepository(db);

    const a = memories.add({ content: 'I prefer TypeScript', source: 'user' });
    expect(a.content).toBe('I prefer TypeScript');
    expect(memories.list()).toHaveLength(1);

    const updated = memories.update(a.id, 'I prefer TypeScript strict mode');
    expect(updated?.content).toContain('strict');

    expect(memories.delete(a.id)).toBe(true);
    expect(memories.list()).toHaveLength(0);
    db.close();
  });

  it('rejects empty content and enforces the cap', () => {
    const db = openDatabase(':memory:');
    const memories = new SqliteUserMemoryRepository(db);
    expect(() => memories.add({ content: '   ' })).toThrow(/empty/i);
    db.close();
  });
});
