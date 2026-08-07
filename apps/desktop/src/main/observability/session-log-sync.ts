import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  parseSessionLogLines,
  readSessionLogMeta,
  type SessionLogUsageEntry,
} from '@pi-desktop/agent-pi';
import type { DesktopDatabase } from '@pi-desktop/database';
import { projectIdForPath } from '@pi-desktop/database';

interface SessionLogSyncState {
  filePath: string;
  lastModified: number;
  lastLineCount: number;
  lastSyncedAt: number;
}

/**
 * Import billable assistant turns from Pi desktop session JSONL files into
 * `run_metrics`, similar to CC Switch's session-log scan (v3.13+).
 */
export class SessionLogSyncService {
  private syncPromise: Promise<{ imported: number }> | null = null;

  constructor(
    private readonly sessionsDir: string,
    private readonly getDb: () => Promise<DesktopDatabase>,
  ) {}

  /** Coalesce concurrent sync requests into one pass. */
  sync(): Promise<{ imported: number }> {
    this.syncPromise ??= this.runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async runSync(): Promise<{ imported: number }> {
    let imported = 0;
    try {
      const files = await readdir(this.sessionsDir);
      const db = await this.getDb();

      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        imported += await this.syncFile(db, path.join(this.sessionsDir, name));
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code === 'ENOENT') return { imported: 0 };
      throw error;
    }
    return { imported };
  }

  private async syncFile(db: DesktopDatabase, filePath: string): Promise<number> {
    const fileStat = await stat(filePath);
    const state = getSyncState(db, filePath);
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const nonEmptyLineCount = lines.filter((line) => line.trim()).length;

    if (
      state &&
      state.lastModified === fileStat.mtimeMs &&
      state.lastLineCount >= nonEmptyLineCount
    ) {
      return 0;
    }

    const meta =
      readSessionLogMeta(lines) ??
      sessionMetaFromFilename(path.basename(filePath));
    if (!meta) return 0;

    const startLine = state?.lastLineCount ?? 0;
    const newLines = lines.slice(startLine);
    const entries = parseSessionLogLines(newLines, meta, (sessionId, cwd) =>
      resolveProjectId(db, sessionId, cwd),
    );

    let imported = 0;
    for (const entry of entries) {
      if (shouldSkipEntry(db, entry)) continue;
      recordSessionLogEntry(db, entry);
      imported++;
    }

    upsertSyncState(db, {
      filePath,
      lastModified: fileStat.mtimeMs,
      lastLineCount: lines.length,
      lastSyncedAt: Date.now(),
    });

    return imported;
  }
}

function sessionMetaFromFilename(name: string): { sessionId: string; cwd: string } | null {
  const match = /^(\d+)_(.+)\.jsonl$/.exec(name);
  if (!match) return null;
  return { sessionId: match[2]!, cwd: '' };
}

function resolveProjectId(db: DesktopDatabase, sessionId: string, cwd: string): string | null {
  const session = db.sessions.get(sessionId);
  if (session?.projectId) return session.projectId;
  if (!cwd) return null;
  const project = db.projects.getByPath(cwd);
  if (project) return project.id;
  return projectIdForPath(cwd);
}

function shouldSkipEntry(db: DesktopDatabase, entry: SessionLogUsageEntry): boolean {
  const existing = db.db
    .prepare(`SELECT 1 FROM run_metrics WHERE run_id = ?`)
    .get(entry.runId);
  if (existing) return true;

  // A live run already captured usage for this assistant turn.
  const covered = db.db
    .prepare(
      `SELECT 1 FROM run_metrics
        WHERE session_id = ?
          AND run_id NOT LIKE 'session-log:%'
          AND input_tokens IS NOT NULL
          AND started_at <= ?
          AND (completed_at IS NULL OR completed_at >= ?)
        LIMIT 1`,
    )
    .get(entry.sessionId, entry.startedAt, entry.startedAt);
  return Boolean(covered);
}

function recordSessionLogEntry(db: DesktopDatabase, entry: SessionLogUsageEntry): void {
  db.db
    .prepare(
      `INSERT OR IGNORE INTO run_metrics (
         run_id, session_id, project_id, provider_id, model_id,
         started_at, completed_at, tool_call_count, file_change_count,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         cost_usd, outcome
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'completed')`,
    )
    .run(
      entry.runId,
      entry.sessionId,
      entry.projectId,
      entry.providerId,
      entry.modelId,
      entry.startedAt,
      entry.completedAt,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheReadTokens,
      entry.cacheWriteTokens,
      entry.costUsd,
    );
}

function getSyncState(db: DesktopDatabase, filePath: string): SessionLogSyncState | null {
  const row = db.db
    .prepare(
      `SELECT file_path, last_modified, last_line_count, last_synced_at
         FROM session_log_sync WHERE file_path = ?`,
    )
    .get(filePath) as
    | {
        file_path: string;
        last_modified: number;
        last_line_count: number;
        last_synced_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    filePath: row.file_path,
    lastModified: row.last_modified,
    lastLineCount: row.last_line_count,
    lastSyncedAt: row.last_synced_at,
  };
}

function upsertSyncState(db: DesktopDatabase, state: SessionLogSyncState): void {
  db.db
    .prepare(
      `INSERT INTO session_log_sync (file_path, last_modified, last_line_count, last_synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         last_modified = excluded.last_modified,
         last_line_count = excluded.last_line_count,
         last_synced_at = excluded.last_synced_at`,
    )
    .run(state.filePath, state.lastModified, state.lastLineCount, state.lastSyncedAt);
}
