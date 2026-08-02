import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

import type { SessionSummary } from '@pi-desktop/protocol';

import type { SessionRepository } from './session-repository.js';
import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';

interface SessionRow {
  id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  archived: number;
  deleted_at: number | null;
}

/**
 * SQLite-backed SessionRepository (plan §10 / §18.1).
 */
export class SqliteSessionRepository implements SessionRepository {
  private db: SqliteDatabase | null = null;
  private readonly ownsDb: boolean;
  private ready = false;
  private readonly dbPath: string | null;

  constructor(dbOrPath: string | SqliteDatabase) {
    if (typeof dbOrPath === 'string') {
      this.dbPath = dbOrPath;
      this.ownsDb = true;
    } else {
      this.db = dbOrPath;
      this.dbPath = null;
      this.ownsDb = false;
      this.ready = true;
    }
  }

  async init(): Promise<void> {
    if (this.ready && this.db) return;
    if (!this.dbPath) {
      throw new Error('SqliteSessionRepository has no db path');
    }
    this.db = openDatabase(this.dbPath);
    this.ready = true;
  }

  listByProject(projectId: string, includeArchived = false): SessionSummary[] {
    const db = this.requireDb();
    const rows = includeArchived
      ? (db
          .prepare(
            // `includeArchived` means archived, not deleted: a soft-deleted
            // session stays out of every list.
            `SELECT id, project_id, title, created_at, updated_at, archived, deleted_at
             FROM sessions WHERE project_id = ? AND deleted_at IS NULL
             ORDER BY updated_at DESC`,
          )
          .all(projectId) as unknown as SessionRow[])
      : (db
          .prepare(
            `SELECT id, project_id, title, created_at, updated_at, archived, deleted_at
             FROM sessions WHERE project_id = ? AND archived = 0 AND deleted_at IS NULL
             ORDER BY updated_at DESC`,
          )
          .all(projectId) as unknown as SessionRow[]);
    return rows.map(rowToSummary);
  }

  listAll(): SessionSummary[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT id, project_id, title, created_at, updated_at, archived, deleted_at
         FROM sessions
         WHERE archived = 0 AND deleted_at IS NULL
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as unknown as SessionRow[];
    return rows.map(rowToSummary);
  }

  get(sessionId: string): SessionSummary | undefined {
    const db = this.requireDb();
    const row = db
      .prepare(
        `SELECT id, project_id, title, created_at, updated_at, archived, deleted_at
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId) as unknown as SessionRow | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  async create(input: { id?: string; projectId: string; title: string }): Promise<SessionSummary> {
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
    return this.put(session);
  }

  async put(session: SessionSummary): Promise<SessionSummary> {
    await this.init();
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO sessions (id, project_id, title, created_at, updated_at, archived, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         archived = excluded.archived,
         deleted_at = excluded.deleted_at`,
    ).run(
      session.id,
      session.projectId,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.archived ? 1 : 0,
      session.deletedAt ?? null,
    );
    return session;
  }

  async rename(sessionId: string, title: string): Promise<SessionSummary> {
    await this.init();
    const existing = this.get(sessionId);
    if (!existing) throw new Error(`Session ${sessionId} not found`);
    const next = { ...existing, title, updatedAt: Date.now() };
    return this.put(next);
  }

  async archive(sessionId: string, archived: boolean): Promise<SessionSummary> {
    await this.init();
    const existing = this.get(sessionId);
    if (!existing) throw new Error(`Session ${sessionId} not found`);
    const next = { ...existing, archived, updatedAt: Date.now() };
    return this.put(next);
  }

  async setDeleted(sessionId: string, deleted: boolean): Promise<SessionSummary> {
    await this.init();
    const existing = this.get(sessionId);
    if (!existing) throw new Error(`Session ${sessionId} not found`);
    const next: SessionSummary = { ...existing, updatedAt: Date.now() };
    if (deleted) next.deletedAt = Date.now();
    else delete next.deletedAt;
    return this.put(next);
  }

  async touch(sessionId: string): Promise<void> {
    await this.init();
    const existing = this.get(sessionId);
    if (!existing) return;
    await this.put({ ...existing, updatedAt: Date.now() });
  }

  close(): void {
    if (this.db && this.ownsDb) {
      this.db.close();
    }
    this.db = null;
    this.ready = false;
  }

  /**
   * One-shot import from legacy JSON SessionStore file.
   * Skips rows that already exist (by id).
   */
  async importFromJsonFile(jsonPath: string): Promise<number> {
    await this.init();
    if (!existsSync(jsonPath)) return 0;
    let parsed: { sessions?: SessionSummary[] };
    try {
      parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as { sessions?: SessionSummary[] };
    } catch {
      return 0;
    }
    let imported = 0;
    for (const session of parsed.sessions ?? []) {
      if (!session?.id || !session.projectId) continue;
      if (this.get(session.id)) continue;
      await this.put({
        id: session.id,
        projectId: session.projectId,
        title: session.title || 'Session',
        createdAt: session.createdAt || Date.now(),
        updatedAt: session.updatedAt || Date.now(),
        archived: Boolean(session.archived),
      });
      imported += 1;
    }
    return imported;
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error('SqliteSessionRepository not initialized — call init() first');
    }
    return this.db;
  }
}

function rowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    ...(row.deleted_at != null ? { deletedAt: row.deleted_at } : {}),
  };
}
