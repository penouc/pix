import type {
  AgentRunRecord,
  BaselineFileRecord,
  CheckpointCleanupResult,
  CheckpointRecoveryConflict,
  CheckpointBaselineInput,
  CheckpointReviewOutcome,
  CheckpointRepository,
  CheckpointSummary,
  WriteSnapshotInput,
  WriteSnapshotRecord,
} from './checkpoint-repository.js';
import type { SqliteDatabase } from './sqlite-connection.js';

interface CheckpointRow {
  id: string;
  project_id: string;
  session_id: string;
  workspace_path: string;
  is_git: number;
  head_oid: string | null;
  index_tree_oid: string | null;
  status_porcelain: Uint8Array;
  state: 'captured' | 'running';
  run_id: string | null;
  review_outcome: CheckpointReviewOutcome | null;
  created_at: number;
}

interface BaselineFileRow {
  path: string;
  original_path: string | null;
  status: string;
  exists_at_baseline: number;
  sha256: string | null;
}

interface AgentRunRow {
  run_id: string;
  checkpoint_id: string;
  project_id: string;
  session_id: string;
  status: 'running';
  created_at: number;
}

interface WriteSnapshotRow {
  checkpoint_id: string;
  path: string;
  existed_before: number;
  content: Uint8Array | null;
  sha256: string | null;
  size: number | null;
  expected_exists: number | null;
  expected_sha256: string | null;
  expected_size: number | null;
  created_at: number;
}

interface RecoveryConflictRow {
  checkpoint_id: string;
  path: string;
  reason: string;
  created_at: number;
}

export class SqliteCheckpointRepository implements CheckpointRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async createBaseline(input: CheckpointBaselineInput): Promise<CheckpointSummary> {
    const createdAt = input.createdAt ?? Date.now();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO checkpoints (
            id, project_id, session_id, workspace_path, is_git, head_oid, index_tree_oid,
            status_porcelain, state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?)`,
        )
        .run(
          input.id,
          input.projectId,
          input.sessionId,
          input.workspacePath,
          input.isGit ? 1 : 0,
          input.headOid ?? null,
          input.indexTreeOid ?? null,
          input.statusPorcelain,
          createdAt,
        );
      const insertFile = this.db.prepare(
        `INSERT INTO checkpoint_baseline_files (
          checkpoint_id, path, original_path, status, exists_at_baseline, sha256
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const file of input.files) {
        insertFile.run(
          input.id,
          file.path,
          file.originalPath ?? null,
          file.status,
          file.exists ? 1 : 0,
          file.sha256 ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(input.id)!;
  }

  async attachRun(input: {
    checkpointId: string;
    runId: string;
    projectId: string;
    sessionId: string;
  }): Promise<AgentRunRecord> {
    const checkpoint = this.get(input.checkpointId);
    if (!checkpoint || checkpoint.state !== 'captured') {
      throw new Error(`Checkpoint ${input.checkpointId} is not attachable`);
    }

    const createdAt = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO agent_runs (run_id, checkpoint_id, project_id, session_id, status, created_at)
           VALUES (?, ?, ?, ?, 'running', ?)`,
        )
        .run(input.runId, input.checkpointId, input.projectId, input.sessionId, createdAt);
      const updated = this.db
        .prepare(
          `UPDATE checkpoints SET state = 'running', run_id = ?
           WHERE id = ? AND state = 'captured'`,
        )
        .run(input.runId, input.checkpointId);
      if (updated.changes !== 1) {
        throw new Error(`Checkpoint ${input.checkpointId} is not attachable`);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getRun(input.runId)!;
  }

  async discard(checkpointId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM checkpoints WHERE id = ? AND state = 'captured'`)
      .run(checkpointId);
  }

  get(checkpointId: string): CheckpointSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, project_id, session_id, workspace_path, is_git, head_oid, index_tree_oid,
                status_porcelain, state, run_id, review_outcome, created_at
         FROM checkpoints WHERE id = ?`,
      )
      .get(checkpointId) as unknown as CheckpointRow | undefined;
    if (!row) return undefined;
    const files = this.db
      .prepare(
        `SELECT path, original_path, status, exists_at_baseline, sha256
         FROM checkpoint_baseline_files WHERE checkpoint_id = ? ORDER BY path`,
      )
      .all(checkpointId) as unknown as BaselineFileRow[];
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id,
      workspacePath: row.workspace_path,
      isGit: row.is_git === 1,
      headOid: row.head_oid ?? undefined,
      indexTreeOid: row.index_tree_oid ?? undefined,
      statusPorcelain: Buffer.from(row.status_porcelain),
      state: row.state,
      runId: row.run_id ?? undefined,
      reviewOutcome: row.review_outcome ?? undefined,
      createdAt: row.created_at,
      files: files.map(rowToBaselineFile),
    };
  }

  getRun(runId: string): AgentRunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT run_id, checkpoint_id, project_id, session_id, status, created_at
         FROM agent_runs WHERE run_id = ?`,
      )
      .get(runId) as unknown as AgentRunRow | undefined;
    return row
      ? {
          runId: row.run_id,
          checkpointId: row.checkpoint_id,
          projectId: row.project_id,
          sessionId: row.session_id,
          status: row.status,
          createdAt: row.created_at,
        }
      : undefined;
  }

  getCheckpointForRun(runId: string): CheckpointSummary | undefined {
    const row = this.db
      .prepare(`SELECT checkpoint_id FROM agent_runs WHERE run_id = ?`)
      .get(runId) as { checkpoint_id: string } | undefined;
    return row ? this.get(row.checkpoint_id) : undefined;
  }

  listRecoverable(): CheckpointSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM checkpoints
         WHERE state = 'running' AND review_outcome IS NULL
         ORDER BY created_at DESC`,
      )
      .all() as { id: string }[];
    return rows.map((row) => this.get(row.id)!);
  }

  async cleanupResolved(before: number): Promise<CheckpointCleanupResult> {
    this.db.exec('BEGIN');
    try {
      const checkpointIds = (
        this.db
          .prepare(
            `SELECT id FROM checkpoints
             WHERE state = 'running' AND review_outcome IS NOT NULL AND created_at < ?`,
          )
          .all(before) as { id: string }[]
      ).map((row) => row.id);
      if (checkpointIds.length > 0) {
        const placeholders = checkpointIds.map(() => '?').join(', ');
        this.db
          .prepare(`DELETE FROM agent_runs WHERE checkpoint_id IN (${placeholders})`)
          .run(...checkpointIds);
        this.db
          .prepare(`DELETE FROM checkpoints WHERE id IN (${placeholders})`)
          .run(...checkpointIds);
      }
      this.db.exec('COMMIT');
      return { deletedCheckpoints: checkpointIds.length };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listWriteSnapshots(checkpointId: string): WriteSnapshotRecord[] {
    const rows = this.db
      .prepare(
        `SELECT checkpoint_id, path, existed_before, content, sha256, size,
                expected_exists, expected_sha256, expected_size, created_at
         FROM checkpoint_write_snapshots WHERE checkpoint_id = ? ORDER BY path`,
      )
      .all(checkpointId) as unknown as WriteSnapshotRow[];
    return rows.map(rowToWriteSnapshot);
  }

  async setReviewOutcome(checkpointId: string, outcome: CheckpointReviewOutcome): Promise<void> {
    const updated = this.db
      .prepare(`UPDATE checkpoints SET review_outcome = ? WHERE id = ? AND state = 'running'`)
      .run(outcome, checkpointId);
    if (updated.changes !== 1) throw new Error(`Checkpoint ${checkpointId} is not reviewable`);
  }

  async storeWriteSnapshot(input: WriteSnapshotInput): Promise<WriteSnapshotRecord> {
    const createdAt = input.createdAt ?? Date.now();
    if (input.existedBefore) {
      if (!input.content || !input.sha256 || input.size === undefined) {
        throw new Error('Existing write snapshots require content, sha256, and size');
      }
    } else if (input.content || input.sha256 || input.size !== undefined) {
      throw new Error('Absent-file snapshots must not include content, sha256, or size');
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO checkpoint_write_snapshots (
          checkpoint_id, path, existed_before, content, sha256, size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.checkpointId,
        input.path,
        input.existedBefore ? 1 : 0,
        input.content ?? null,
        input.sha256 ?? null,
        input.size ?? null,
        createdAt,
      );
    return this.getWriteSnapshot(input.checkpointId, input.path)!;
  }

  async setExpectedWriteState(input: {
    checkpointId: string;
    path: string;
    exists: boolean;
    sha256?: string;
    size?: number;
  }): Promise<void> {
    if (input.exists && (!input.sha256 || input.size === undefined)) {
      throw new Error('Existing expected write states require sha256 and size');
    }
    if (!input.exists && (input.sha256 || input.size !== undefined)) {
      throw new Error('Absent expected write states must not include sha256 or size');
    }
    const updated = this.db
      .prepare(
        `UPDATE checkpoint_write_snapshots
         SET expected_exists = ?, expected_sha256 = ?, expected_size = ?
         WHERE checkpoint_id = ? AND path = ?`,
      )
      .run(
        input.exists ? 1 : 0,
        input.sha256 ?? null,
        input.size ?? null,
        input.checkpointId,
        input.path,
      );
    if (updated.changes !== 1) {
      throw new Error(`No write snapshot for expected state: ${input.path}`);
    }
  }

  async recordRecoveryConflict(input: {
    checkpointId: string;
    path: string;
    reason: string;
  }): Promise<CheckpointRecoveryConflict> {
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO checkpoint_recovery_conflicts (checkpoint_id, path, reason, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(checkpoint_id, path) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
      )
      .run(input.checkpointId, input.path, input.reason, createdAt);
    return { checkpointId: input.checkpointId, path: input.path, reason: input.reason, createdAt };
  }

  async clearRecoveryConflict(checkpointId: string, snapshotPath: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM checkpoint_recovery_conflicts WHERE checkpoint_id = ? AND path = ?`)
      .run(checkpointId, snapshotPath);
  }

  listRecoveryConflicts(checkpointId: string): CheckpointRecoveryConflict[] {
    return (
      this.db
        .prepare(
          `SELECT checkpoint_id, path, reason, created_at
           FROM checkpoint_recovery_conflicts WHERE checkpoint_id = ? ORDER BY path`,
        )
        .all(checkpointId) as unknown as RecoveryConflictRow[]
    ).map((row) => ({
      checkpointId: row.checkpoint_id,
      path: row.path,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  getWriteSnapshot(checkpointId: string, snapshotPath: string): WriteSnapshotRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT checkpoint_id, path, existed_before, content, sha256, size,
                expected_exists, expected_sha256, expected_size, created_at
         FROM checkpoint_write_snapshots WHERE checkpoint_id = ? AND path = ?`,
      )
      .get(checkpointId, snapshotPath) as unknown as WriteSnapshotRow | undefined;
    return row ? rowToWriteSnapshot(row) : undefined;
  }
}

function rowToBaselineFile(row: BaselineFileRow): BaselineFileRecord {
  return {
    path: row.path,
    originalPath: row.original_path ?? undefined,
    status: row.status,
    exists: row.exists_at_baseline === 1,
    sha256: row.sha256 ?? undefined,
  };
}

function rowToWriteSnapshot(row: WriteSnapshotRow): WriteSnapshotRecord {
  return {
    checkpointId: row.checkpoint_id,
    path: row.path,
    existedBefore: row.existed_before === 1,
    content: row.content ? Buffer.from(row.content) : undefined,
    sha256: row.sha256 ?? undefined,
    size: row.size ?? undefined,
    expectedExists: row.expected_exists === null ? undefined : row.expected_exists === 1,
    expectedSha256: row.expected_sha256 ?? undefined,
    expectedSize: row.expected_size ?? undefined,
    createdAt: row.created_at,
  };
}
