/**
 * Versioned SQLite migrations (plan §10.1).
 * Applied in order; schema_migrations tracks applied versions.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'sessions_and_schema_meta',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
  ON sessions (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project_archived
  ON sessions (project_id, archived);
`,
  },
  {
    version: 2,
    name: 'projects',
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
  is_git INTEGER NOT NULL DEFAULT 0 CHECK (is_git IN (0, 1)),
  last_opened_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_last_opened
  ON projects (last_opened_at DESC);
`,
  },
];
