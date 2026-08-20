import path from 'node:path';

import type { ProjectRepository } from './project-repository.js';
import type { SessionRepository } from './session-repository.js';
import type { CheckpointRepository } from './checkpoint-repository.js';
import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';
import { SqliteCheckpointRepository } from './sqlite-checkpoint-repository.js';
import { SqliteHistoryRepository } from './sqlite-history-repository.js';
import { SqliteIndexRepository } from './sqlite-index-repository.js';
import { SqliteProjectRepository } from './sqlite-project-repository.js';
import { SqliteRunMetricsRepository } from './sqlite-run-metrics-repository.js';
import { SqliteSessionMessageRepository } from './sqlite-session-message-repository.js';
import { SqliteSessionRepository } from './sqlite-session-repository.js';
import { SqliteTodoRepository } from './sqlite-todo-repository.js';
import type { TodoRepository } from './todo-repository.js';

/**
 * Single SQLite connection for desktop Main process (plan §10).
 * Shares one WAL database across session + project repositories.
 */
export class DesktopDatabase {
  readonly db: SqliteDatabase;
  readonly sessions: SqliteSessionRepository;
  readonly sessionMessages: SqliteSessionMessageRepository;
  readonly projects: SqliteProjectRepository;
  readonly checkpoints: SqliteCheckpointRepository;
  readonly runMetrics: SqliteRunMetricsRepository;
  readonly index: SqliteIndexRepository;
  readonly todos: SqliteTodoRepository;
  readonly history: SqliteHistoryRepository;
  readonly dbPath: string;

  private constructor(dbPath: string, db: SqliteDatabase) {
    this.dbPath = dbPath;
    this.db = db;
    this.sessions = new SqliteSessionRepository(db);
    this.sessionMessages = new SqliteSessionMessageRepository(db);
    this.projects = new SqliteProjectRepository(db);
    this.checkpoints = new SqliteCheckpointRepository(db);
    this.runMetrics = new SqliteRunMetricsRepository(db);
    this.index = new SqliteIndexRepository(db);
    this.todos = new SqliteTodoRepository(db);
    this.history = new SqliteHistoryRepository(db);
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

export type { SessionRepository, ProjectRepository, CheckpointRepository, TodoRepository };
