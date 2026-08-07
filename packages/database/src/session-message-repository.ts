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
  /**
   * Drop a session's stored transcript. Session Fork (#10) rewinds the Pi
   * session; the stored rows describe the abandoned branch and must go so
   * `list` falls through to the Pi branch again.
   */
  deleteBySession(sessionId: string): Promise<void>;
}
