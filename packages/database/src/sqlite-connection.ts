import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from './migrations.js';

export type SqliteDatabase = DatabaseSync;

/**
 * Open (or create) the desktop SQLite DB and apply pending migrations.
 * Uses Node built-in `node:sqlite` — no native addon rebuild for Electron.
 */
export function openDatabase(dbPath: string): SqliteDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  applyMigrations(db);
  ensureContentIndex(db);
  return db;
}

/** How the content index can be searched in this runtime. */
export type ContentIndexMode = 'fts5' | 'like';

/**
 * Create the file-body table in whichever shape this SQLite build supports, and
 * report which one that is.
 *
 * FTS5 cannot be assumed. Electron 36's bundled `node:sqlite` ships without any
 * FTS module (`no such module: fts5`), while a standalone Node 22 build has it —
 * so a check run under `node` says yes and the app then fails at launch. Hence a
 * runtime probe rather than a compile-time or authoring-time assumption.
 *
 * Idempotent: safe to call on every open.
 */
export function ensureContentIndex(db: SqliteDatabase): ContentIndexMode {
  if (tableExists(db, 'index_content')) {
    return isVirtualTable(db, 'index_content') ? 'fts5' : 'like';
  }
  try {
    db.exec(`
CREATE VIRTUAL TABLE index_content USING fts5(
  path,
  body,
  project_id UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2"
);`);
    return 'fts5';
  } catch {
    // No FTS module — fall back to a plain table scanned with LIKE.
    db.exec(`
CREATE TABLE IF NOT EXISTS index_content (
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_content_project ON index_content(project_id);`);
    return 'like';
  }
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return row !== undefined;
}

function isVirtualTable(db: SqliteDatabase, name: string): boolean {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as
    | { sql: string | null }
    | undefined;
  return /CREATE\s+VIRTUAL\s+TABLE/i.test(row?.sql ?? '');
}

export function applyMigrations(db: SqliteDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => Number((row as { version: number }).version)),
  );

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
