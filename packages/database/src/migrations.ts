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
];
