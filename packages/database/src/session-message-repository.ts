import type { StoredMessage } from '@pi-desktop/protocol';

export interface SessionMessageRecord extends StoredMessage {
  id: string;
  sessionId: string;
  sequence: number;
  createdAt: number;
}

export interface SessionMessageRepository {
  append(input: {
    id: string;
    sessionId: string;
    role: StoredMessage['role'];
    text: string;
    createdAt?: number;
  }): Promise<void>;
  list(sessionId: string): StoredMessage[];
  /** Import Pi transcript rows when SQLite has none yet. */
  backfill(sessionId: string, messages: StoredMessage[]): Promise<number>;
}
