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
  {
    version: 3,
    name: 'checkpoints_agent_runs_and_baseline_files',
    sql: `
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  is_git INTEGER NOT NULL CHECK (is_git IN (0, 1)),
  head_oid TEXT,
  index_tree_oid TEXT,
  status_porcelain BLOB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('captured', 'running')),
  run_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session_created
  ON checkpoints (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  checkpoint_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created
  ON agent_runs (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkpoint_baseline_files (
  checkpoint_id TEXT NOT NULL,
  path TEXT NOT NULL,
  original_path TEXT,
  status TEXT NOT NULL,
  exists_at_baseline INTEGER NOT NULL CHECK (exists_at_baseline IN (0, 1)),
  sha256 TEXT,
  PRIMARY KEY (checkpoint_id, path),
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
);
`,
  },
  {
    version: 4,
    name: 'checkpoint_write_snapshots',
    sql: `
CREATE TABLE IF NOT EXISTS checkpoint_write_snapshots (
  checkpoint_id TEXT NOT NULL,
  path TEXT NOT NULL,
  existed_before INTEGER NOT NULL CHECK (existed_before IN (0, 1)),
  content BLOB,
  sha256 TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (checkpoint_id, path),
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
  CHECK (
    (existed_before = 0 AND content IS NULL AND sha256 IS NULL AND size IS NULL) OR
    (existed_before = 1 AND content IS NOT NULL AND sha256 IS NOT NULL AND size IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_write_snapshots_checkpoint
  ON checkpoint_write_snapshots (checkpoint_id, created_at);
`,
  },
  {
    version: 5,
    name: 'checkpoint_review_outcomes',
    sql: `
ALTER TABLE checkpoints ADD COLUMN review_outcome TEXT
  CHECK (review_outcome IN ('kept', 'continued', 'reverted'));
`,
  },
  {
    version: 6,
    name: 'checkpoint_write_snapshot_expected_states',
    sql: `
ALTER TABLE checkpoint_write_snapshots ADD COLUMN expected_exists INTEGER
  CHECK (expected_exists IN (0, 1));
ALTER TABLE checkpoint_write_snapshots ADD COLUMN expected_sha256 TEXT;
ALTER TABLE checkpoint_write_snapshots ADD COLUMN expected_size INTEGER;
`,
  },
  {
    version: 7,
    name: 'checkpoint_recovery_conflicts',
    sql: `
CREATE TABLE IF NOT EXISTS checkpoint_recovery_conflicts (
  checkpoint_id TEXT NOT NULL,
  path TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (checkpoint_id, path),
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
);
`,
  },
  {
    version: 8,
    name: 'sessions_soft_delete',
    sql: `
ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;
`,
  },
  {
    version: 9,
    name: 'run_metrics',
    sql: `
CREATE TABLE IF NOT EXISTS run_metrics (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  first_token_at INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  file_change_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS run_metrics_started_at ON run_metrics(started_at);
CREATE INDEX IF NOT EXISTS run_metrics_project ON run_metrics(project_id);
`,
  },
  {
    version: 10,
    name: 'workspace_index',
    sql: `
CREATE TABLE IF NOT EXISTS index_files (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  -- rowid of this file's row in index_content, or NULL when only the path is
  -- indexed (too big, binary, or content indexing off). Kept so a re-index can
  -- delete the old body by rowid instead of scanning the FTS table.
  content_rowid INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS index_files_key ON index_files(project_id, path);
CREATE INDEX IF NOT EXISTS index_files_path ON index_files(path);

-- index_content is deliberately NOT created here. Whether it can be an FTS5
-- virtual table depends on the SQLite the runtime was built against, and that
-- is not knowable at migration-authoring time: Electron 36's bundled node:sqlite
-- has no FTS module at all, while a plain Node 22 build does. A migration that
-- assumed FTS5 failed on Electron and took the whole database down with it, so
-- the table is created at open time by ensureContentIndex(), which picks the
-- shape the runtime actually supports.

CREATE TABLE IF NOT EXISTS index_state (
  project_id TEXT PRIMARY KEY,
  head TEXT,
  files INTEGER NOT NULL DEFAULT 0,
  indexed_bytes INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  duration_ms INTEGER
);
`,
  },
  {
    version: 11,
    name: 'session_messages',
    sql: `
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session_sequence
  ON session_messages (session_id, sequence);
`,
  },
  {
    version: 12,
    name: 'session_log_sync',
    sql: `
CREATE TABLE IF NOT EXISTS session_log_sync (
  file_path TEXT PRIMARY KEY NOT NULL,
  last_modified INTEGER NOT NULL,
  last_line_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER NOT NULL
);
`,
  },
  {
    version: 13,
    name: 'session_messages_timeline_kinds',
    sql: `
CREATE TABLE session_messages_v13 (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'thinking', 'tool')),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

INSERT INTO session_messages_v13 (id, session_id, kind, role, text, sequence, created_at)
SELECT id, session_id, 'message', role, text, sequence, created_at
FROM session_messages;

DROP TABLE session_messages;
ALTER TABLE session_messages_v13 RENAME TO session_messages;

CREATE INDEX IF NOT EXISTS idx_session_messages_session_sequence
  ON session_messages (session_id, sequence);
`,
  },
  {
    version: 14,
    name: 'session_todos',
    sql: `
CREATE TABLE IF NOT EXISTS session_todos (
  session_id TEXT PRIMARY KEY NOT NULL,
  items_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`,
  },
];
