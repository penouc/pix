import path from 'node:path';

import type { ProjectRepository } from './project-repository.js';
import type { SessionRepository } from './session-repository.js';
import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';
import { SqliteProjectRepository } from './sqlite-project-repository.js';
import { SqliteSessionRepository } from './sqlite-session-repository.js';

/**
 * Single SQLite connection for desktop Main process (plan §10).
 * Shares one WAL database across session + project repositories.
 */
export class DesktopDatabase {
  readonly db: SqliteDatabase;
  readonly sessions: SqliteSessionRepository;
  readonly projects: SqliteProjectRepository;
  readonly dbPath: string;

  private constructor(dbPath: string, db: SqliteDatabase) {
    this.dbPath = dbPath;
    this.db = db;
    this.sessions = new SqliteSessionRepository(db);
    this.projects = new SqliteProjectRepository(db);
  }

  static open(dbPath: string): DesktopDatabase {
    const resolved = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
    const db = openDatabase(resolved);
    return new DesktopDatabase(resolved, db);
  }

  /** Import legacy JSON files from userData (idempotent). */
  async migrateLegacyJson(userDataDir: string): Promise<{ sessions: number; projects: number }> {
    const sessions = await this.sessions.importFromJsonFile(
      path.join(userDataDir, 'sessions.json'),
    );
    const projects = await this.projects.importFromJsonFile(
      path.join(userDataDir, 'recent-projects.json'),
    );
    return { sessions, projects };
  }

  close(): void {
    // Repos share this.db and do not own it when constructed with a DatabaseSync.
    this.db.close();
  }
}

export type { SessionRepository, ProjectRepository };
