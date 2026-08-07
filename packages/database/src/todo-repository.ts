import type { TodoItem } from '@pi-desktop/protocol';

/** #11: durable per-session todo checklists. */
export interface TodoRepository {
  /** Stored checklist for a session; empty array when none exists yet. */
  load(sessionId: string): TodoItem[];
  /** Replace the session's checklist. */
  save(sessionId: string, items: TodoItem[]): void;
}
