/** One indexed file, as the indexer knows it on disk. */
export interface IndexFileRecord {
  path: string;
  size: number;
  mtimeMs: number;
  contentRowid: number | null;
}

export interface IndexFileInput {
  projectId: string;
  path: string;
  size: number;
  mtimeMs: number;
  /** Omit to index the path only — used for binaries and oversized files. */
  body?: string;
}

export interface IndexPathHit {
  projectId: string;
  path: string;
}

export interface IndexContentHit {
  projectId: string;
  path: string;
  /** A single line-ish excerpt around the match, with match markers stripped. */
  excerpt: string;
}

export interface IndexStateRecord {
  projectId: string;
  /** git HEAD at the time of the last refresh, or null outside a repo. */
  head: string | null;
  files: number;
  indexedBytes: number;
  /** Files listed but not content-indexed (binary, oversized, over budget). */
  skipped: number;
  updatedAt: number;
  durationMs: number | null;
}

/**
 * Cross-project file and content index (plan §26 "global indexing").
 *
 * Pi Agent itself has no persistent index — its search tools are stateless
 * ripgrep calls scoped to one workspace — so searching across the projects you
 * have open requires the desktop app to keep its own. Paths live in a plain
 * table; bodies live in an FTS5 virtual table, which ships with the SQLite that
 * `node:sqlite` is built against, so this adds no dependency.
 */
export interface IndexRepository {
  /** Everything currently indexed for a project, keyed by path. */
  listFiles(projectId: string): Map<string, IndexFileRecord>;
  upsertFile(input: IndexFileInput): void;
  deleteFile(projectId: string, path: string): void;
  deleteProject(projectId: string): void;

  /** Substring path search. `projectIds` empty means every indexed project. */
  searchPaths(input: { query: string; projectIds?: string[]; limit?: number }): IndexPathHit[];
  /** Full-text search over indexed bodies. */
  searchContent(input: { query: string; projectIds?: string[]; limit?: number }): IndexContentHit[];

  /**
   * Immediate children of `prefix` ('' for the project root), derived from the
   * indexed paths. The tree therefore shows exactly what search can find, and
   * inherits the index's `.gitignore` handling and trust gate for free.
   */
  listChildren(projectId: string, prefix: string): { directories: string[]; files: string[] };

  putState(state: IndexStateRecord): void;
  getState(projectId: string): IndexStateRecord | undefined;
  listStates(): IndexStateRecord[];
}
