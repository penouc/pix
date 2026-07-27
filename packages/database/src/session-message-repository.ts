import type { StoredMessage } from '@pi-desktop/protocol';

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  sequence: number;
  createdAt: number;
  entry: StoredMessage;
}

export interface SessionMessageRepository {
  append(input: {
    id: string;
    sessionId: string;
    entry: StoredMessage;
    createdAt?: number;
  }): Promise<void>;
  list(sessionId: string): StoredMessage[];
  /** Import Pi transcript rows when SQLite has none yet. */
  backfill(sessionId: string, messages: StoredMessage[]): Promise<number>;
}
