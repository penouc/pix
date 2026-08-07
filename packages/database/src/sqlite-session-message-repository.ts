import type { StoredMessage } from '@pi-desktop/protocol';

import type { SessionMessageRepository } from './session-message-repository.js';
import type { SqliteDatabase } from './sqlite-connection.js';

interface MessageRow {
  id: string;
  session_id: string;
  kind: string;
  role: string;
  text: string;
  sequence: number;
  created_at: number;
}

const RICH_MESSAGE_PREFIX = '\u001ePIX_MESSAGE:';

interface MessagePayload {
  text: string;
  images: Array<{ name: string; mimeType: string; size: number }>;
}

interface ToolPayload {
  toolName: string;
  inputSummary: string;
  outputSummary?: string;
  ok?: boolean;
  status: 'running' | 'completed' | 'failed';
}

function serializeEntry(entry: StoredMessage): { kind: string; role: string; text: string } {
  if (entry.kind === 'message') {
    if (entry.images?.length) {
      const payload: MessagePayload = { text: entry.text, images: entry.images };
      return {
        kind: 'message',
        role: entry.role,
        text: `${RICH_MESSAGE_PREFIX}${JSON.stringify(payload)}`,
      };
    }
    return { kind: 'message', role: entry.role, text: entry.text };
  }
  if (entry.kind === 'thinking') {
    return { kind: 'thinking', role: 'thinking', text: entry.content };
  }
  const payload: ToolPayload = {
    toolName: entry.toolName,
    inputSummary: entry.inputSummary,
    outputSummary: entry.outputSummary,
    ok: entry.ok,
    status: entry.status,
  };
  return { kind: 'tool', role: 'tool', text: JSON.stringify(payload) };
}

function deserializeRow(
  row: Pick<MessageRow, 'id' | 'kind' | 'role' | 'text'>,
): StoredMessage | null {
  const kind = row.kind || 'message';
  if (kind === 'thinking' || row.role === 'thinking') {
    const content = row.text.trim();
    if (!content) return null;
    return { kind: 'thinking', id: row.id, content };
  }
  if (kind === 'tool' || row.role === 'tool') {
    try {
      const parsed = JSON.parse(row.text) as ToolPayload;
      if (!parsed.toolName) return null;
      return {
        kind: 'tool',
        id: row.id,
        toolName: parsed.toolName,
        inputSummary: parsed.inputSummary ?? '',
        outputSummary: parsed.outputSummary,
        ok: parsed.ok,
        status: parsed.status ?? 'completed',
      };
    } catch {
      return {
        kind: 'tool',
        id: row.id,
        toolName: 'tool',
        inputSummary: row.text,
        status: 'completed',
      };
    }
  }
  if (row.role === 'user' || row.role === 'assistant' || row.role === 'system') {
    if (row.text.startsWith(RICH_MESSAGE_PREFIX)) {
      try {
        const payload = JSON.parse(row.text.slice(RICH_MESSAGE_PREFIX.length)) as MessagePayload;
        return {
          kind: 'message',
          role: row.role,
          text: payload.text ?? '',
          images: Array.isArray(payload.images) ? payload.images : [],
        };
      } catch {
        return { kind: 'message', role: row.role, text: row.text };
      }
    }
    return { kind: 'message', role: row.role, text: row.text };
  }
  return null;
}

export class SqliteSessionMessageRepository implements SessionMessageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private getById(id: string): StoredMessage | null {
    const row = this.db
      .prepare(`SELECT id, kind, role, text FROM session_messages WHERE id = ?`)
      .get(id) as Pick<MessageRow, 'id' | 'kind' | 'role' | 'text'> | undefined;
    if (!row) return null;
    return deserializeRow(row);
  }

  append(input: {
    id: string;
    sessionId: string;
    entry: StoredMessage;
    createdAt?: number;
  }): Promise<void> {
    let entry = input.entry;
    if (entry.kind === 'tool') {
      const existing = this.getById(input.id);
      if (existing?.kind === 'tool') {
        entry = {
          kind: 'tool',
          id: entry.id,
          toolName: entry.toolName || existing.toolName,
          inputSummary: entry.inputSummary || existing.inputSummary,
          outputSummary: entry.outputSummary ?? existing.outputSummary,
          ok: entry.ok ?? existing.ok,
          // A late tool.requested must not reopen a finished card.
          status:
            existing.status !== 'running' && entry.status === 'running'
              ? existing.status
              : entry.status,
        };
      }
    }

    const serialized = serializeEntry(entry);
    const text = serialized.text.trim();
    if (!text) return Promise.resolve();

    const createdAt = input.createdAt ?? Date.now();
    const nextSequence =
      (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(sequence), -1) AS max_seq FROM session_messages WHERE session_id = ?',
          )
          .get(input.sessionId) as { max_seq: number }
      ).max_seq + 1;

    this.db
      .prepare(
        `INSERT INTO session_messages (id, session_id, kind, role, text, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           text = excluded.text,
           role = excluded.role`,
      )
      .run(
        input.id,
        input.sessionId,
        serialized.kind,
        serialized.role,
        text,
        nextSequence,
        createdAt,
      );

    return Promise.resolve();
  }

  list(sessionId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, role, text FROM session_messages
         WHERE session_id = ?
         ORDER BY sequence ASC`,
      )
      .all(sessionId) as Array<Pick<MessageRow, 'id' | 'kind' | 'role' | 'text'>>;

    const out: StoredMessage[] = [];
    for (const row of rows) {
      const entry = deserializeRow(row);
      if (entry) out.push(entry);
    }
    return out;
  }

  backfill(sessionId: string, messages: StoredMessage[]): Promise<number> {
    if (!messages.length) return Promise.resolve(0);
    const existing = this.list(sessionId);
    if (existing.length > 0) return Promise.resolve(0);

    const createdAt = Date.now();
    let sequence = 0;
    for (const message of messages) {
      const serialized = serializeEntry(message);
      const text = serialized.text.trim();
      if (!text) continue;
      const id =
        message.kind === 'thinking' || message.kind === 'tool'
          ? message.id
          : `${sessionId}-${sequence}`;
      this.db
        .prepare(
          `INSERT INTO session_messages (id, session_id, kind, role, text, sequence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, serialized.kind, serialized.role, text, sequence, createdAt + sequence);
      sequence += 1;
    }
    return Promise.resolve(sequence);
  }

  deleteBySession(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(sessionId);
    return Promise.resolve();
  }
}
