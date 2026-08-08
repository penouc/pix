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
 *
 * Session-log rows are the source of truth for per-turn tokens (including
 * prompt-cache reads). Live runs that overlap those turns keep their
 * tool/file counters, but their token/cost fields are cleared so Usage
 * totals do not double-count.
 */
export class SessionLogSyncService {
  private syncPromise: Promise<{ imported: number }> | null = null;
  /** Sticky across coalesced callers so a forced backfill is not dropped. */
  private pendingForce = false;

  constructor(
    private readonly sessionsDir: string,
    private readonly getDb: () => Promise<DesktopDatabase>,
  ) {}

  /** Coalesce concurrent sync requests into one pass. */
  sync(options?: { force?: boolean }): Promise<{ imported: number }> {
    if (options?.force) this.pendingForce = true;
    this.syncPromise ??= (async () => {
      // Let same-tick coalesced `sync({ force: true })` callers set the flag
      // before we snapshot it.
      await Promise.resolve();
      const force = this.pendingForce;
      this.pendingForce = false;
      try {
        return await this.runSync(force);
      } finally {
        this.syncPromise = null;
      }
    })();
    return this.syncPromise;
  }

  private async runSync(force: boolean): Promise<{ imported: number }> {
    let imported = 0;
    try {
      const files = await readdir(this.sessionsDir);
      const db = await this.getDb();

      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        imported += await this.syncFile(db, path.join(this.sessionsDir, name), force);
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code === 'ENOENT') return { imported: 0 };
      throw error;
    }
    return { imported };
  }

  private async syncFile(
    db: DesktopDatabase,
    filePath: string,
    force: boolean,
  ): Promise<number> {
    const fileStat = await stat(filePath);
    const state = force ? null : getSyncState(db, filePath);
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

    // `lastLineCount` is stored as `lines.length` (including a trailing empty
    // split). Re-read from 0 when forcing a backfill so older rows can pick up
    // cache tokens that earlier imports dropped.
    const startLine = state?.lastLineCount ?? 0;
    const newLines = lines.slice(startLine);
    const entries = parseSessionLogLines(newLines, meta, (sessionId, cwd) =>
      resolveProjectId(db, sessionId, cwd),
    );

    let imported = 0;
    for (const entry of entries) {
      const changed = recordSessionLogEntry(db, entry);
      // Always drop overlapping live token totals once per-turn rows exist,
      // even when the session-log row itself did not need an update.
      clearOverlappingLiveRunTokens(db, entry);
      if (changed) imported++;
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

function tokenTotal(entry: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): number {
  return (
    (entry.inputTokens ?? 0) +
    (entry.outputTokens ?? 0) +
    (entry.cacheReadTokens ?? 0) +
    (entry.cacheWriteTokens ?? 0)
  );
}

/**
 * Upsert a session-log turn. Returns true when the row was inserted or its
 * token/cost fields were refreshed with richer data.
 */
export function recordSessionLogEntry(
  db: DesktopDatabase,
  entry: SessionLogUsageEntry,
): boolean {
  const existing = db.db
    .prepare(
      `SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
         FROM run_metrics WHERE run_id = ?`,
    )
    .get(entry.runId) as
    | {
        input_tokens: number | null;
        output_tokens: number | null;
        cache_read_tokens: number | null;
        cache_write_tokens: number | null;
        cost_usd: number | null;
      }
    | undefined;

  if (existing) {
    const existingTotal = tokenTotal({
      inputTokens: existing.input_tokens,
      outputTokens: existing.output_tokens,
      cacheReadTokens: existing.cache_read_tokens,
      cacheWriteTokens: existing.cache_write_tokens,
    });
    const nextTotal = tokenTotal(entry);
    const costRicher = entry.costUsd > (existing.cost_usd ?? 0);
    if (nextTotal <= existingTotal && !costRicher) {
      return false;
    }
    db.db
      .prepare(
        `UPDATE run_metrics SET
           provider_id = ?,
           model_id = ?,
           input_tokens = ?,
           output_tokens = ?,
           cache_read_tokens = ?,
           cache_write_tokens = ?,
           cost_usd = ?
         WHERE run_id = ?`,
      )
      .run(
        entry.providerId,
        entry.modelId,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheWriteTokens,
        entry.costUsd,
        entry.runId,
      );
    return true;
  }

  db.db
    .prepare(
      `INSERT INTO run_metrics (
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
  return true;
}

/**
 * Live runs aggregate tokens across a tool loop, but historically missed
 * cacheRead. Once per-turn session-log rows exist for that window, drop the
 * live token/cost fields so Usage sums the accurate per-turn rows only.
 */
export function clearOverlappingLiveRunTokens(
  db: DesktopDatabase,
  entry: SessionLogUsageEntry,
): void {
  db.db
    .prepare(
      `UPDATE run_metrics
          SET input_tokens = NULL,
              output_tokens = NULL,
              cache_read_tokens = NULL,
              cache_write_tokens = NULL,
              cost_usd = NULL
        WHERE session_id = ?
          AND run_id NOT LIKE 'session-log:%'
          AND input_tokens IS NOT NULL
          AND started_at <= ?
          AND (completed_at IS NULL OR completed_at >= ?)`,
    )
    .run(entry.sessionId, entry.startedAt, entry.startedAt);
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
