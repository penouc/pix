import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { HistoryAgentId, HistoryMessage, HistorySessionMeta } from '@pi-desktop/protocol';

import type { SqliteDatabase } from './sqlite-connection.js';

interface SessionRow {
  key: string;
  agent_id: string;
  native_id: string;
  title: string;
  project_path: string;
  project_name: string;
  file_path: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  model: string | null;
  tokens_used: number | null;
  origin: string;
  pix_session_id: string | null;
  pix_project_id: string | null;
  favorite: number;
}

interface MessageRow {
  seq: number;
  role: string;
  kind: string;
  text: string;
  tool_name: string | null;
  thinking: string | null;
  ts: number | null;
}

export interface HistoryListInput {
  agent?: HistoryAgentId;
  projectPath?: string;
  favoriteOnly?: boolean;
  titleQuery?: string;
  /** When true, only archived sessions. Default lists exclude archived. */
  archivedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface HistoryWriteInput {
  meta: HistorySessionMeta;
  fileMtime: number;
  fileSize: number;
  units: Array<{
    seq: number;
    role: 'user' | 'assistant' | 'system';
    kind: 'text' | 'thinking' | 'tool';
    text: string;
    toolName?: string;
    thinking?: string;
    timestamp?: number | null;
  }>;
}

function rowToMeta(row: SessionRow): HistorySessionMeta {
  return {
    key: row.key,
    agent: row.agent_id as HistoryAgentId,
    nativeId: row.native_id,
    title: row.title,
    projectPath: row.project_path,
    projectName: row.project_name,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    model: row.model,
    tokensUsed: row.tokens_used,
    favorite: row.favorite === 1,
    origin: row.origin === 'pix' ? 'pix' : 'external',
    ...(row.pix_session_id ? { pixSessionId: row.pix_session_id } : {}),
    ...(row.pix_project_id ? { pixProjectId: row.pix_project_id } : {}),
  };
}

const SESSION_COLS = `s.key, s.agent_id, s.native_id, s.title, s.project_path, s.project_name,
  s.file_path, s.created_at, s.updated_at, s.message_count, s.model, s.tokens_used,
  s.origin, s.pix_session_id, s.pix_project_id, COALESCE(u.favorite, 0) AS favorite`;

export class SqliteHistoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  knownFiles(): Map<string, { mtime: number; size: number; key: string; title: string; agent: string }> {
    const rows = this.db
      .prepare(`SELECT file_path, file_mtime, file_size, key, title, agent_id FROM history_sessions`)
      .all() as unknown as Array<{
      file_path: string;
      file_mtime: number;
      file_size: number;
      key: string;
      title: string;
      agent_id: string;
    }>;
    return new Map(
      rows.map((r) => [
        r.file_path,
        { mtime: r.file_mtime, size: r.file_size, key: r.key, title: r.title, agent: r.agent_id },
      ]),
    );
  }

  isTombstoned(filePath: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM history_tombstones WHERE file_path = ?`)
      .get(filePath) as { ok: number } | undefined;
    return Boolean(row);
  }

  writeSession(input: HistoryWriteInput): void {
    const { meta, fileMtime, fileSize, units } = input;
    this.db.exec('BEGIN');
    try {
      // Adapters may change native ids (e.g. Codex stem → session UUID). The
      // file_path unique index then blocks INSERT under the new key and ingest
      // fails silently — leaving stale Untitled rows forever.
      const existingByFile = this.db
        .prepare(`SELECT key FROM history_sessions WHERE file_path = ?`)
        .get(meta.filePath) as { key: string } | undefined;
      if (existingByFile && existingByFile.key !== meta.key) {
        this.db
          .prepare(`DELETE FROM history_messages WHERE session_key = ?`)
          .run(existingByFile.key);
        this.db.prepare(`DELETE FROM history_sessions WHERE key = ?`).run(existingByFile.key);
        this.db
          .prepare(`UPDATE history_user_data SET session_key = ? WHERE session_key = ?`)
          .run(meta.key, existingByFile.key);
      }

      this.db.prepare(`DELETE FROM history_messages WHERE session_key = ?`).run(meta.key);
      this.db
        .prepare(
          `INSERT INTO history_sessions (
             key, agent_id, native_id, title, project_path, project_name, file_path,
             created_at, updated_at, message_count, model, tokens_used,
             file_mtime, file_size, origin, pix_session_id, pix_project_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             title = excluded.title,
             project_path = excluded.project_path,
             project_name = excluded.project_name,
             file_path = excluded.file_path,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             message_count = excluded.message_count,
             model = excluded.model,
             tokens_used = excluded.tokens_used,
             file_mtime = excluded.file_mtime,
             file_size = excluded.file_size,
             origin = excluded.origin,
             pix_session_id = excluded.pix_session_id,
             pix_project_id = excluded.pix_project_id`,
        )
        .run(
          meta.key,
          meta.agent,
          meta.nativeId,
          meta.title,
          meta.projectPath,
          meta.projectName,
          meta.filePath,
          meta.createdAt,
          meta.updatedAt,
          meta.messageCount,
          meta.model ?? null,
          meta.tokensUsed ?? null,
          fileMtime,
          fileSize,
          meta.origin,
          meta.pixSessionId ?? null,
          meta.pixProjectId ?? null,
        );

      const insertMsg = this.db.prepare(
        `INSERT INTO history_messages (session_key, seq, role, kind, text, tool_name, thinking, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const unit of units) {
        insertMsg.run(
          meta.key,
          unit.seq,
          unit.role,
          unit.kind,
          unit.text,
          unit.toolName ?? null,
          unit.thinking ?? null,
          unit.timestamp ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  removeSession(key: string, tombstone: boolean): void {
    this.db.exec('BEGIN');
    try {
      const row = this.db
        .prepare(`SELECT file_path FROM history_sessions WHERE key = ?`)
        .get(key) as { file_path: string } | undefined;
      this.db.prepare(`DELETE FROM history_messages WHERE session_key = ?`).run(key);
      this.db.prepare(`DELETE FROM history_sessions WHERE key = ?`).run(key);
      if (tombstone && row?.file_path) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO history_tombstones (file_path, deleted_at) VALUES (?, ?)`,
          )
          .run(row.file_path, Date.now());
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  removeByPath(filePath: string): void {
    const row = this.db
      .prepare(`SELECT key FROM history_sessions WHERE file_path = ?`)
      .get(filePath) as { key: string } | undefined;
    if (row) this.removeSession(row.key, false);
  }

  setFavorite(key: string, favorite: boolean): void {
    this.db
      .prepare(
        `INSERT INTO history_user_data (session_key, favorite, pinned, updated_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           favorite = excluded.favorite,
           updated_at = excluded.updated_at`,
      )
      .run(key, favorite ? 1 : 0, Date.now());
  }

  get(key: string): HistorySessionMeta | null {
    const row = this.db
      .prepare(
        `SELECT ${SESSION_COLS}
         FROM history_sessions s
         LEFT JOIN history_user_data u ON u.session_key = s.key
         WHERE s.key = ?`,
      )
      .get(key) as SessionRow | undefined;
    return row ? rowToMeta(row) : null;
  }

  list(filter: HistoryListInput = {}): { sessions: HistorySessionMeta[]; total: number } {
    const wheres: string[] = [];
    const args: Array<string | number> = [];
    if (filter.agent) {
      wheres.push('s.agent_id = ?');
      args.push(filter.agent);
    }
    if (filter.projectPath) {
      wheres.push('s.project_path = ?');
      args.push(normalizeProjectPath(filter.projectPath));
    }
    if (filter.favoriteOnly) {
      wheres.push('COALESCE(u.favorite, 0) = 1');
    }
    if (filter.titleQuery?.trim()) {
      wheres.push('(s.title LIKE ? ESCAPE \'\\\' OR s.project_name LIKE ? ESCAPE \'\\\')');
      const like = `%${escapeLike(filter.titleQuery.trim())}%`;
      args.push(like, like);
    }
    if (filter.archivedOnly) {
      wheres.push('a.session_key IS NOT NULL');
    } else {
      wheres.push('a.session_key IS NULL');
    }
    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const fromSql = `FROM history_sessions s
         LEFT JOIN history_user_data u ON u.session_key = s.key
         LEFT JOIN history_archived_sessions a ON a.session_key = s.key`;
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n ${fromSql} ${whereSql}`)
      .get(...args) as { n: number };
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 200;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT ${SESSION_COLS}
         ${fromSql}
         ${whereSql}
         ORDER BY COALESCE(u.pinned, 0) DESC, s.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as unknown as SessionRow[];
    return { sessions: rows.map(rowToMeta), total: totalRow.n };
  }

  listMessages(key: string): HistoryMessage[] {
    const rows = this.db
      .prepare(
        `SELECT seq, role, kind, text, tool_name, thinking, ts
         FROM history_messages WHERE session_key = ? ORDER BY seq ASC`,
      )
      .all(key) as unknown as MessageRow[];
    return rows.map((r) => ({
      seq: r.seq,
      role: r.role as HistoryMessage['role'],
      kind: (r.kind as HistoryMessage['kind']) || 'text',
      text: r.text,
      ...(r.tool_name ? { toolName: r.tool_name } : {}),
      ...(r.thinking ? { thinking: r.thinking } : {}),
      timestamp: r.ts,
    }));
  }

  agentCounts(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT s.agent_id, COUNT(*) AS n
         FROM history_sessions s
         LEFT JOIN history_archived_sessions a ON a.session_key = s.key
         WHERE a.session_key IS NULL
         GROUP BY s.agent_id`,
      )
      .all() as unknown as Array<{ agent_id: string; n: number }>;
    return new Map(rows.map((r) => [r.agent_id, r.n]));
  }

  projectCounts(): Array<{ path: string; name: string; count: number; lastActive: number }> {
    const rows = this.db
      .prepare(
        `SELECT s.project_path AS path, s.project_name AS name, COUNT(*) AS count, MAX(s.updated_at) AS last_active
         FROM history_sessions s
         LEFT JOIN history_archived_sessions a ON a.session_key = s.key
         WHERE s.project_path != '' AND a.session_key IS NULL
         GROUP BY s.project_path
         ORDER BY last_active DESC`,
      )
      .all() as unknown as Array<{
      path: string;
      name: string;
      count: number;
      last_active: number;
    }>;
    return rows.map((r) => ({
      path: r.path,
      name: r.name || projectNameOf(r.path),
      count: r.count,
      lastActive: r.last_active,
    }));
  }

  setProjectArchived(projectPath: string, archived: boolean, projectName = ''): void {
    const resolved = normalizeProjectPath(projectPath);
    if (!resolved) return;
    if (archived) {
      this.db
        .prepare(
          `INSERT INTO history_archived_projects (project_path, project_name, archived_at)
           VALUES (?, ?, ?)
           ON CONFLICT(project_path) DO UPDATE SET
             project_name = CASE
               WHEN excluded.project_name != '' THEN excluded.project_name
               ELSE history_archived_projects.project_name
             END,
             archived_at = excluded.archived_at`,
        )
        .run(resolved, projectName || projectNameOf(resolved), Date.now());
    } else {
      this.db.prepare(`DELETE FROM history_archived_projects WHERE project_path = ?`).run(resolved);
    }
  }

  isProjectArchived(projectPath: string): boolean {
    const resolved = normalizeProjectPath(projectPath);
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM history_archived_projects WHERE project_path = ?`)
      .get(resolved) as { ok: number } | undefined;
    return Boolean(row);
  }

  archivedProjectPaths(): Set<string> {
    const rows = this.db
      .prepare(`SELECT project_path FROM history_archived_projects`)
      .all() as unknown as Array<{ project_path: string }>;
    return new Set(rows.map((r) => normalizeProjectPath(r.project_path) || r.project_path));
  }

  listArchivedProjects(): Array<{ path: string; name: string; archivedAt: number }> {
    const rows = this.db
      .prepare(
        `SELECT project_path AS path, project_name AS name, archived_at AS archived_at
         FROM history_archived_projects
         ORDER BY archived_at DESC`,
      )
      .all() as unknown as Array<{ path: string; name: string; archived_at: number }>;
    return rows.map((r) => ({
      path: r.path,
      name: r.name || projectNameOf(r.path),
      archivedAt: r.archived_at,
    }));
  }

  setSessionArchived(key: string, archived: boolean, meta?: HistorySessionMeta | null): void {
    if (archived) {
      const row = meta ?? this.get(key);
      this.db
        .prepare(
          `INSERT INTO history_archived_sessions
             (session_key, title, agent_id, project_path, project_name, archived_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_key) DO UPDATE SET
             title = excluded.title,
             agent_id = excluded.agent_id,
             project_path = excluded.project_path,
             project_name = excluded.project_name,
             archived_at = excluded.archived_at`,
        )
        .run(
          key,
          row?.title ?? '',
          row?.agent ?? '',
          row?.projectPath ?? '',
          row?.projectName ?? '',
          Date.now(),
        );
    } else {
      this.db.prepare(`DELETE FROM history_archived_sessions WHERE session_key = ?`).run(key);
    }
  }

  isSessionArchived(key: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM history_archived_sessions WHERE session_key = ?`)
      .get(key) as { ok: number } | undefined;
    return Boolean(row);
  }

  listArchivedSessions(): Array<{
    key: string;
    title: string;
    agent: string;
    projectPath: string;
    projectName: string;
    archivedAt: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT session_key AS key, title, agent_id AS agent, project_path AS path,
                project_name AS name, archived_at AS archived_at
         FROM history_archived_sessions
         ORDER BY archived_at DESC`,
      )
      .all() as unknown as Array<{
      key: string;
      title: string;
      agent: string;
      path: string;
      name: string;
      archived_at: number;
    }>;
    return rows.map((r) => ({
      key: r.key,
      title: r.title || 'Untitled',
      agent: r.agent,
      projectPath: r.path,
      projectName: r.name || projectNameOf(r.path),
      archivedAt: r.archived_at,
    }));
  }

  /**
   * Rewrite stored project_path values using an explicit from→to map
   * (built by the desktop history service with git-root / ancestor merge).
   */
  remapProjectPaths(mapping: Map<string, string>): number {
    let changed = 0;
    this.db.exec('BEGIN');
    try {
      const updateSession = this.db.prepare(
        `UPDATE history_sessions
         SET project_path = ?, project_name = ?
         WHERE project_path = ?`,
      );
      for (const [from, to] of mapping) {
        if (!from || !to || from === to) continue;
        updateSession.run(to, projectNameOf(to), from);
        changed += 1;
      }

      const archived = this.db
        .prepare(`SELECT project_path AS path, project_name AS name FROM history_archived_projects`)
        .all() as unknown as Array<{ path: string; name: string }>;
      for (const { path: raw, name } of archived) {
        const next = mapping.get(raw) ?? normalizeProjectPath(raw);
        if (!next || next === raw) continue;
        this.db.prepare(`DELETE FROM history_archived_projects WHERE project_path = ?`).run(raw);
        this.db
          .prepare(
            `INSERT INTO history_archived_projects (project_path, project_name, archived_at)
             VALUES (?, ?, ?)
             ON CONFLICT(project_path) DO UPDATE SET
               project_name = CASE
                 WHEN excluded.project_name != '' THEN excluded.project_name
                 ELSE history_archived_projects.project_name
               END`,
          )
          .run(next, name || projectNameOf(next), Date.now());
        changed += 1;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return changed;
  }

  distinctProjectPaths(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT project_path AS path FROM history_sessions WHERE project_path != ''`)
      .all() as unknown as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /**
   * Rewrite stored project_path values to their canonical form so sessions from
   * different agents that share a folder collapse into one Projects row.
   */
  canonicalizeProjectPaths(): number {
    const sessionPaths = this.distinctProjectPaths();
    const mapping = new Map<string, string>();
    for (const raw of sessionPaths) {
      const next = normalizeProjectPath(raw);
      if (next && next !== raw) mapping.set(raw, next);
    }
    // Also collapse normalized duplicates that only differ by trailing slash etc.
    // Full git/ancestor merge happens in HistoryService.mergeProjectPaths().
    return this.remapProjectPaths(mapping);
  }

  /** Drop external rows for an agent so a rescan can rebuild them. Pix rows stay. */
  clearExternalAgent(agentId: HistoryAgentId): void {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `DELETE FROM history_messages WHERE session_key IN (
             SELECT key FROM history_sessions WHERE agent_id = ? AND origin = 'external'
           )`,
        )
        .run(agentId);
      this.db
        .prepare(`DELETE FROM history_sessions WHERE agent_id = ? AND origin = 'external'`)
        .run(agentId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function projectNameOf(projectPath: string): string {
  if (!projectPath) return '';
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/** Same rules as the desktop history adapter — keep list/archive keys consistent. */
export function normalizeProjectPath(raw: string): string {
  if (!raw) return '';
  let p = raw.trim();
  if (!p) return '';
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//, ''));
    } catch {
      p = p.replace(/^file:\/\//, '');
    }
  }
  if (p.startsWith('~/') || p === '~') {
    p = path.join(homedir(), p.slice(1));
  }
  try {
    p = path.resolve(p);
  } catch {
    return stripTrailingSlash(p.replace(/\\/g, '/'));
  }
  try {
    if (existsSync(p)) p = realpathSync(p);
  } catch {
    /* keep resolved path */
  }
  return stripTrailingSlash(p);
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    return p.replace(/[/\\]+$/, '');
  }
  return p;
}
