import type { StoredMessage } from '@pi-desktop/protocol';

import type { SessionMessageRepository } from './session-message-repository.js';
import type { SqliteDatabase } from './sqlite-connection.js';

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  text: string;
  sequence: number;
  created_at: number;
}

export class SqliteSessionMessageRepository implements SessionMessageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(input: {
    id: string;
    sessionId: string;
    role: StoredMessage['role'];
    text: string;
    createdAt?: number;
  }): Promise<void> {
    const text = input.text.trim();
    if (!text) return Promise.resolve();

    const createdAt = input.createdAt ?? Date.now();
    const nextSequence =
      (this.db
        .prepare('SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM session_messages WHERE session_id = ?')
        .get(input.sessionId) as { max_seq: number }).max_seq + 1;

    this.db
      .prepare(
        `INSERT INTO session_messages (id, session_id, role, text, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           role = excluded.role`,
      )
      .run(input.id, input.sessionId, input.role, text, nextSequence, createdAt);

    return Promise.resolve();
  }

  list(sessionId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT role, text FROM session_messages
         WHERE session_id = ?
         ORDER BY sequence ASC`,
      )
      .all(sessionId) as Array<Pick<MessageRow, 'role' | 'text'>>;

    return rows.map((row) => ({
      role: row.role as StoredMessage['role'],
      text: row.text,
    }));
  }

  backfill(sessionId: string, messages: StoredMessage[]): Promise<number> {
    if (!messages.length) return Promise.resolve(0);
    const existing = this.list(sessionId);
    if (existing.length > 0) return Promise.resolve(0);

    const createdAt = Date.now();
    let sequence = 0;
    for (const message of messages) {
      const text = message.text.trim();
      if (!text) continue;
      this.db
        .prepare(
          `INSERT INTO session_messages (id, session_id, role, text, sequence, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `${sessionId}-${sequence}`,
          sessionId,
          message.role,
          text,
          sequence,
          createdAt + sequence,
        );
      sequence += 1;
    }
    return Promise.resolve(sequence);
  }
}
