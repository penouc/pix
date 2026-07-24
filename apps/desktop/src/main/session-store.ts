import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SessionSummary } from '@pi-desktop/protocol';

/**
 * Desktop-owned session metadata persistence (plan §10).
 * JSON file backend — SQLite Repository will replace storage without changing callers.
 */
export class SessionStore {
  private readonly byId = new Map<string, SessionSummary>();
  private loaded = false;

  constructor(private readonly persistPath: string) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as { sessions?: SessionSummary[] };
      for (const session of parsed.sessions ?? []) {
        if (session?.id && session.projectId) {
          this.byId.set(session.id, session);
        }
      }
    } catch {
      // empty
    }
    this.loaded = true;
  }

  listByProject(projectId: string, includeArchived = false): SessionSummary[] {
    return [...this.byId.values()]
      .filter((s) => s.projectId === projectId && (includeArchived || !s.archived))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(sessionId: string): SessionSummary | undefined {
    return this.byId.get(sessionId);
  }

  async create(input: {
    id?: string;
    projectId: string;
    title: string;
  }): Promise<SessionSummary> {
    await this.init();
    const now = Date.now();
    const session: SessionSummary = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    this.byId.set(session.id, session);
    await this.persist();
    return session;
  }

  /** Upsert after AgentRuntime creates a Pi-backed session with a known id. */
  async put(session: SessionSummary): Promise<SessionSummary> {
    await this.init();
    this.byId.set(session.id, session);
    await this.persist();
    return session;
  }

  async rename(sessionId: string, title: string): Promise<SessionSummary> {
    await this.init();
    const existing = this.byId.get(sessionId);
    if (!existing) throw new Error(`Session ${sessionId} not found`);
    const next = { ...existing, title, updatedAt: Date.now() };
    this.byId.set(sessionId, next);
    await this.persist();
    return next;
  }

  async archive(sessionId: string, archived: boolean): Promise<SessionSummary> {
    await this.init();
    const existing = this.byId.get(sessionId);
    if (!existing) throw new Error(`Session ${sessionId} not found`);
    const next = { ...existing, archived, updatedAt: Date.now() };
    this.byId.set(sessionId, next);
    await this.persist();
    return next;
  }

  async touch(sessionId: string): Promise<void> {
    const existing = this.byId.get(sessionId);
    if (!existing) return;
    existing.updatedAt = Date.now();
    this.byId.set(sessionId, existing);
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(
        this.persistPath,
        JSON.stringify({ sessions: [...this.byId.values()] }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('[SessionStore] persist failed', error);
    }
  }
}
