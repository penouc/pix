import { randomUUID } from 'node:crypto';

import type { SavedMemory } from '@pi-desktop/protocol';

import type { SqliteDatabase } from './sqlite-connection.js';
import type { UserMemoryRepository } from './user-memory-repository.js';

interface MemoryRow {
  id: string;
  content: string;
  source: string;
  created_at: number;
  updated_at: number;
}

const MAX_CONTENT = 2000;
const MAX_MEMORIES = 200;

function rowToMemory(row: MemoryRow): SavedMemory {
  return {
    id: row.id,
    content: row.content,
    source: row.source === 'agent' ? 'agent' : 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteUserMemoryRepository implements UserMemoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): SavedMemory[] {
    const rows = this.db
      .prepare(
        `SELECT id, content, source, created_at, updated_at
         FROM user_memories
         ORDER BY updated_at DESC`,
      )
      .all() as unknown as MemoryRow[];
    return rows.map(rowToMemory);
  }

  get(id: string): SavedMemory | undefined {
    const row = this.db
      .prepare(
        `SELECT id, content, source, created_at, updated_at
         FROM user_memories WHERE id = ?`,
      )
      .get(id) as unknown as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  add(input: { content: string; source?: SavedMemory['source'] }): SavedMemory {
    const content = input.content.trim().slice(0, MAX_CONTENT);
    if (!content) throw new Error('Memory content is empty');
    const count = (
      this.db.prepare('SELECT COUNT(*) AS n FROM user_memories').get() as { n: number }
    ).n;
    if (count >= MAX_MEMORIES) {
      throw new Error(`Memory limit reached (${MAX_MEMORIES}). Delete some before adding more.`);
    }
    const now = Date.now();
    const memory: SavedMemory = {
      id: randomUUID(),
      content,
      source: input.source ?? 'user',
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO user_memories (id, content, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(memory.id, memory.content, memory.source, memory.createdAt, memory.updatedAt);
    return memory;
  }

  update(id: string, content: string): SavedMemory | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = content.trim().slice(0, MAX_CONTENT);
    if (!next) throw new Error('Memory content is empty');
    const updatedAt = Date.now();
    this.db
      .prepare(`UPDATE user_memories SET content = ?, updated_at = ? WHERE id = ?`)
      .run(next, updatedAt, id);
    return { ...existing, content: next, updatedAt };
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM user_memories WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0;
  }

  clear(): number {
    const result = this.db.prepare('DELETE FROM user_memories').run();
    return Number(result.changes ?? 0);
  }
}
