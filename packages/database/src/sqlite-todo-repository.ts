import { TodoItemSchema, type TodoItem } from '@pi-desktop/protocol';

import type { SqliteDatabase } from './sqlite-connection.js';
import type { TodoRepository } from './todo-repository.js';

interface TodoRow {
  items_json: string;
}

/** Defensive parse: a corrupt row must read as an empty list, never crash. */
function parseItems(json: string | undefined): TodoItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = TodoItemSchema.array().safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export class SqliteTodoRepository implements TodoRepository {
  constructor(private readonly db: SqliteDatabase) {}

  load(sessionId: string): TodoItem[] {
    const row = this.db
      .prepare('SELECT items_json FROM session_todos WHERE session_id = ?')
      .get(sessionId) as TodoRow | undefined;
    return parseItems(row?.items_json);
  }

  save(sessionId: string, items: TodoItem[]): void {
    this.db
      .prepare(
        `INSERT INTO session_todos (session_id, items_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           items_json = excluded.items_json,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, JSON.stringify(items), Date.now());
  }
}
