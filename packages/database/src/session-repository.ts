import type { SessionSummary } from '@pi-desktop/protocol';

/**
 * Desktop Session metadata repository (plan §10).
 * Implementations must only run in Electron Main (or Node tests).
 */
export interface SessionRepository {
  init(): Promise<void>;
  listByProject(projectId: string, includeArchived?: boolean): SessionSummary[];
  get(sessionId: string): SessionSummary | undefined;
  create(input: {
    id?: string;
    projectId: string;
    title: string;
  }): Promise<SessionSummary>;
  put(session: SessionSummary): Promise<SessionSummary>;
  rename(sessionId: string, title: string): Promise<SessionSummary>;
  archive(sessionId: string, archived: boolean): Promise<SessionSummary>;
  touch(sessionId: string): Promise<void>;
  close(): void;
}
