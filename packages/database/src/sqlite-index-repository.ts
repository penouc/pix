import type {
  IndexContentHit,
  IndexFileInput,
  IndexFileRecord,
  IndexPathHit,
  IndexRepository,
  IndexStateRecord,
} from './index-repository.js';
import type { SqliteDatabase } from './sqlite-connection.js';

interface FileRow {
  path: string;
  size: number;
  mtime_ms: number;
  content_rowid: number | null;
}

interface StateRow {
  project_id: string;
  head: string | null;
  files: number;
  indexed_bytes: number;
  skipped: number;
  updated_at: number;
  duration_ms: number | null;
}

/** Path candidates pulled before JS ranking. Bounded so a bare `e` cannot pull a repo. */
const PATH_CANDIDATE_CAP = 4000;

export class SqliteIndexRepository implements IndexRepository {
  constructor(private readonly db: SqliteDatabase) {}

  listFiles(projectId: string): Map<string, IndexFileRecord> {
    const rows = this.db
      .prepare(
        `SELECT path, size, mtime_ms, content_rowid FROM index_files WHERE project_id = ?`,
      )
      .all(projectId) as unknown as FileRow[];
    return new Map(
      rows.map((row) => [
        row.path,
        { path: row.path, size: row.size, mtimeMs: row.mtime_ms, contentRowid: row.content_rowid },
      ]),
    );
  }

  upsertFile(input: IndexFileInput): void {
    // Drop the previous body first: FTS5 has no upsert, and leaving the old row
    // behind would return two hits for one file after an edit.
    const existing = this.db
      .prepare(`SELECT content_rowid FROM index_files WHERE project_id = ? AND path = ?`)
      .get(input.projectId, input.path) as unknown as { content_rowid: number | null } | undefined;
    if (existing?.content_rowid != null) {
      this.db.prepare(`DELETE FROM index_content WHERE rowid = ?`).run(existing.content_rowid);
    }

    let contentRowid: number | null = null;
    if (input.body != null) {
      const result = this.db
        .prepare(`INSERT INTO index_content (path, body, project_id) VALUES (?, ?, ?)`)
        .run(input.path, input.body, input.projectId);
      contentRowid = Number(result.lastInsertRowid);
    }

    this.db
      .prepare(
        `INSERT INTO index_files (project_id, path, size, mtime_ms, indexed_at, content_rowid)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, path) DO UPDATE SET
           size = excluded.size,
           mtime_ms = excluded.mtime_ms,
           indexed_at = excluded.indexed_at,
           content_rowid = excluded.content_rowid`,
      )
      .run(input.projectId, input.path, input.size, input.mtimeMs, Date.now(), contentRowid);
  }

  deleteFile(projectId: string, path: string): void {
    const existing = this.db
      .prepare(`SELECT content_rowid FROM index_files WHERE project_id = ? AND path = ?`)
      .get(projectId, path) as unknown as { content_rowid: number | null } | undefined;
    if (existing?.content_rowid != null) {
      this.db.prepare(`DELETE FROM index_content WHERE rowid = ?`).run(existing.content_rowid);
    }
    this.db.prepare(`DELETE FROM index_files WHERE project_id = ? AND path = ?`).run(projectId, path);
  }

  deleteProject(projectId: string): void {
    this.db.prepare(`DELETE FROM index_content WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM index_files WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM index_state WHERE project_id = ?`).run(projectId);
  }

  searchPaths(input: { query: string; projectIds?: string[]; limit?: number }): IndexPathHit[] {
    const needle = input.query.trim().toLowerCase();
    if (!needle) return [];
    const limit = input.limit ?? 20;
    const scope = scopeClause(input.projectIds);

    const rows = this.db
      .prepare(
        `SELECT project_id, path FROM index_files
          WHERE path LIKE ? ESCAPE '\\' ${scope.sql}
          LIMIT ${PATH_CANDIDATE_CAP}`,
      )
      .all(`%${escapeLike(needle)}%`, ...scope.args) as unknown as Array<{
      project_id: string;
      path: string;
    }>;

    // Rank basename hits above mid-path hits, earlier above later, shorter above
    // longer — the same ordering the single-project palette search used.
    const scored = rows.map((row) => {
      const lower = row.path.toLowerCase();
      const at = lower.indexOf(needle);
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      return {
        hit: { projectId: row.project_id, path: row.path },
        score: (base.includes(needle) ? 0 : 500) + at + row.path.length / 1000,
      };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map((entry) => entry.hit);
  }

  searchContent(input: {
    query: string;
    projectIds?: string[];
    limit?: number;
  }): IndexContentHit[] {
    const match = toMatchQuery(input.query);
    if (!match) return [];
    const limit = input.limit ?? 20;
    const scope = scopeClause(input.projectIds);

    try {
      const rows = this.db
        .prepare(
          `SELECT project_id, path,
                  snippet(index_content, 1, '', '', '…', 12) AS excerpt
             FROM index_content
            WHERE index_content MATCH ? ${scope.sql}
            ORDER BY bm25(index_content, 2.0, 1.0)
            LIMIT ?`,
        )
        .all(match, ...scope.args, limit) as unknown as Array<{
        project_id: string;
        path: string;
        excerpt: string;
      }>;
      return rows.map((row) => ({
        projectId: row.project_id,
        path: row.path,
        excerpt: row.excerpt.replace(/\s+/g, ' ').trim(),
      }));
    } catch {
      // A MATCH the tokenizer rejects is a user typing, not a bug worth throwing.
      return [];
    }
  }

  listChildren(projectId: string, prefix: string): { directories: string[]; files: string[] } {
    const normalized = prefix.replace(/^\/+|\/+$/g, '');
    const like = normalized ? `${escapeLike(normalized)}/%` : '%';
    const rows = this.db
      .prepare(
        `SELECT path FROM index_files WHERE project_id = ? AND path LIKE ? ESCAPE '\\' ORDER BY path`,
      )
      .all(projectId, like) as unknown as Array<{ path: string }>;

    const offset = normalized ? normalized.length + 1 : 0;
    const directories = new Set<string>();
    const files: string[] = [];
    for (const row of rows) {
      const remainder = row.path.slice(offset);
      if (!remainder) continue;
      const slash = remainder.indexOf('/');
      // A remainder with a separator names a directory we have not walked into.
      if (slash === -1) files.push(remainder);
      else directories.add(remainder.slice(0, slash));
    }
    return { directories: [...directories].sort(), files };
  }

  putState(state: IndexStateRecord): void {
    this.db
      .prepare(
        `INSERT INTO index_state (project_id, head, files, indexed_bytes, skipped, updated_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           head = excluded.head,
           files = excluded.files,
           indexed_bytes = excluded.indexed_bytes,
           skipped = excluded.skipped,
           updated_at = excluded.updated_at,
           duration_ms = excluded.duration_ms`,
      )
      .run(
        state.projectId,
        state.head,
        state.files,
        state.indexedBytes,
        state.skipped,
        state.updatedAt,
        state.durationMs,
      );
  }

  getState(projectId: string): IndexStateRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM index_state WHERE project_id = ?`)
      .get(projectId) as unknown as StateRow | undefined;
    return row ? rowToState(row) : undefined;
  }

  listStates(): IndexStateRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM index_state ORDER BY updated_at DESC`)
      .all() as unknown as StateRow[];
    return rows.map(rowToState);
  }
}

function rowToState(row: StateRow): IndexStateRecord {
  return {
    projectId: row.project_id,
    head: row.head,
    files: row.files,
    indexedBytes: row.indexed_bytes,
    skipped: row.skipped,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
  };
}

function scopeClause(projectIds?: string[]): { sql: string; args: string[] } {
  if (!projectIds?.length) return { sql: '', args: [] };
  return {
    sql: `AND project_id IN (${projectIds.map(() => '?').join(', ')})`,
    args: projectIds,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Turn free text into an FTS5 MATCH expression.
 *
 * Raw input cannot go in: `-`, `*`, `:`, `(`, `"` and the bare words `AND`/`OR`
 * are all operators, so a query like `foo-bar` or `TODO:` is a syntax error
 * rather than a search. Quoting each token makes every character literal, and a
 * trailing `*` on the last token gives as-you-type prefix matching.
 */
export function toMatchQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0);
  if (!tokens.length) return null;
  return tokens
    .map((token, index) => (index === tokens.length - 1 ? `"${token}"*` : `"${token}"`))
    .join(' ');
}
