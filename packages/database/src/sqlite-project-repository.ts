import { createHash } from 'node:crypto';
import { accessSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ProjectSummary } from '@pi-desktop/protocol';

import type { ProjectRepository } from './project-repository.js';
import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';

interface ProjectRow {
  id: string;
  path: string;
  name: string;
  trusted: number;
  is_git: number;
  last_opened_at: number;
}

export function projectIdForPath(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

/** Match history sidebar identity: resolve symlinks when the folder exists. */
export function canonicalProjectPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  try {
    if (existsSync(resolved)) return realpathSync(resolved);
  } catch {
    /* keep resolved */
  }
  return resolved;
}

/**
 * SQLite-backed ProjectRepository (plan §10 / §18.1).
 */
export class SqliteProjectRepository implements ProjectRepository {
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
      throw new Error('SqliteProjectRepository has no db path');
    }
    this.db = openDatabase(this.dbPath);
    this.ready = true;
  }

  listRecent(limit = 20): ProjectSummary[] {
    const db = this.requireDb();
    const rows = db
      .prepare(
        `SELECT id, path, name, trusted, is_git, last_opened_at
         FROM projects
         ORDER BY last_opened_at DESC, name COLLATE NOCASE ASC
         LIMIT ?`,
      )
      .all(limit) as unknown as ProjectRow[];
    return rows.map(rowToSummary);
  }

  get(id: string): ProjectSummary | undefined {
    const db = this.requireDb();
    const row = db
      .prepare(
        `SELECT id, path, name, trusted, is_git, last_opened_at
         FROM projects WHERE id = ?`,
      )
      .get(id) as unknown as ProjectRow | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  getByPath(projectPath: string): ProjectSummary | undefined {
    const db = this.requireDb();
    const candidates = new Set<string>([
      path.resolve(projectPath),
      canonicalProjectPath(projectPath),
    ]);
    for (const candidate of candidates) {
      const row = db
        .prepare(
          `SELECT id, path, name, trusted, is_git, last_opened_at
           FROM projects WHERE path = ?`,
        )
        .get(candidate) as unknown as ProjectRow | undefined;
      if (row) return rowToSummary(row);
    }
    return undefined;
  }

  async open(rawPath: string): Promise<ProjectSummary> {
    await this.init();
    const resolved = canonicalProjectPath(rawPath);
    const st = statSync(resolved);
    if (!st.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }

    let isGit = false;
    try {
      accessSync(path.join(resolved, '.git'));
      isGit = true;
    } catch {
      isGit = false;
    }

    const existing = this.getByPath(resolved) ?? this.get(projectIdForPath(resolved));
    const trusted = existing ? existing.trusted : isGit;
    const summary: ProjectSummary = {
      id: existing?.id ?? projectIdForPath(resolved),
      path: resolved,
      name: path.basename(resolved) || resolved,
      trusted,
      isGit,
      // Bump on every open so the Projects sidebar floats the folder you just picked.
      lastOpenedAt: Date.now(),
    };
    return this.put(summary);
  }

  async setTrust(projectId: string, trusted: boolean): Promise<ProjectSummary> {
    await this.init();
    const existing = this.get(projectId);
    if (!existing) {
      throw new Error(`Project ${projectId} not found`);
    }
    return this.put({
      ...existing,
      trusted,
      lastOpenedAt: Date.now(),
    });
  }

  async put(project: ProjectSummary): Promise<ProjectSummary> {
    await this.init();
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO projects (id, path, name, trusted, is_git, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         name = excluded.name,
         trusted = excluded.trusted,
         is_git = excluded.is_git,
         last_opened_at = excluded.last_opened_at`,
    ).run(
      project.id,
      project.path,
      project.name,
      project.trusted ? 1 : 0,
      project.isGit ? 1 : 0,
      project.lastOpenedAt,
    );
    return project;
  }

  close(): void {
    if (this.db && this.ownsDb) {
      this.db.close();
    }
    this.db = null;
    this.ready = false;
  }

  /**
   * Import legacy recent-projects.json once (skip existing ids).
   */
  async importFromJsonFile(jsonPath: string): Promise<number> {
    await this.init();
    if (!existsSync(jsonPath)) return 0;
    let parsed: { projects?: ProjectSummary[] };
    try {
      parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as { projects?: ProjectSummary[] };
    } catch {
      return 0;
    }
    let imported = 0;
    for (const project of parsed.projects ?? []) {
      if (!project?.id || !project.path) continue;
      if (this.get(project.id) || this.getByPath(project.path)) continue;
      await this.put({
        id: project.id,
        path: project.path,
        name: project.name || path.basename(project.path),
        trusted: Boolean(project.trusted),
        isGit: Boolean(project.isGit),
        lastOpenedAt: project.lastOpenedAt || Date.now(),
      });
      imported += 1;
    }
    return imported;
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error('SqliteProjectRepository not initialized — call init() first');
    }
    return this.db;
  }
}

function rowToSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    trusted: row.trusted === 1,
    isGit: row.is_git === 1,
    lastOpenedAt: row.last_opened_at,
  };
}
