export type AgentRunStatus = 'running';
export type CheckpointReviewOutcome = 'kept' | 'continued' | 'reverted';

export interface BaselineFileRecord {
  path: string;
  originalPath?: string;
  status: string;
  exists: boolean;
  sha256?: string;
}

export interface CheckpointBaselineInput {
  id: string;
  projectId: string;
  sessionId: string;
  workspacePath: string;
  isGit: boolean;
  headOid?: string;
  indexTreeOid?: string;
  statusPorcelain: Buffer;
  files: BaselineFileRecord[];
  createdAt?: number;
}

export interface CheckpointSummary {
  id: string;
  projectId: string;
  sessionId: string;
  workspacePath: string;
  isGit: boolean;
  headOid?: string;
  indexTreeOid?: string;
  statusPorcelain: Buffer;
  state: 'captured' | 'running';
  runId?: string;
  reviewOutcome?: CheckpointReviewOutcome;
  createdAt: number;
  files: BaselineFileRecord[];
}

export interface AgentRunRecord {
  runId: string;
  checkpointId: string;
  projectId: string;
  sessionId: string;
  status: AgentRunStatus;
  createdAt: number;
}

/** Immutable bytes captured immediately before the first agent write to a path. */
export interface WriteSnapshotRecord {
  checkpointId: string;
  path: string;
  existedBefore: boolean;
  content?: Buffer;
  sha256?: string;
  size?: number;
  /** State left by the successfully completed agent write; never stores content. */
  expectedExists?: boolean;
  expectedSha256?: string;
  expectedSize?: number;
  createdAt: number;
}

export interface WriteSnapshotInput {
  checkpointId: string;
  path: string;
  existedBefore: boolean;
  content?: Buffer;
  sha256?: string;
  size?: number;
  createdAt?: number;
}

export interface CheckpointRecoveryConflict {
  checkpointId: string;
  path: string;
  reason: string;
  createdAt: number;
}

export interface CheckpointCleanupResult {
  deletedCheckpoints: number;
}

/** Main-process persistence boundary for task-before checkpoint baselines. */
export interface CheckpointRepository {
  createBaseline(input: CheckpointBaselineInput): Promise<CheckpointSummary>;
  attachRun(input: {
    checkpointId: string;
    runId: string;
    projectId: string;
    sessionId: string;
  }): Promise<AgentRunRecord>;
  discard(checkpointId: string): Promise<void>;
  get(checkpointId: string): CheckpointSummary | undefined;
  getRun(runId: string): AgentRunRecord | undefined;
  getCheckpointForRun(runId: string): CheckpointSummary | undefined;
  /** Running checkpoints without a user resolution survive crashes and are safe to review. */
  listRecoverable(): CheckpointSummary[];
  /**
   * Deletes only user-resolved checkpoints older than the cutoff. Cascades remove
   * their snapshot BLOBs and conflict rows; unresolved recovery data is retained.
   */
  cleanupResolved(before: number): Promise<CheckpointCleanupResult>;
  listWriteSnapshots(checkpointId: string): WriteSnapshotRecord[];
  setReviewOutcome(checkpointId: string, outcome: CheckpointReviewOutcome): Promise<void>;
  /** Stores only the first snapshot for a checkpoint-relative path. */
  storeWriteSnapshot(input: WriteSnapshotInput): Promise<WriteSnapshotRecord>;
  /** Records the filesystem state only after the corresponding write/edit succeeded. */
  setExpectedWriteState(input: {
    checkpointId: string;
    path: string;
    exists: boolean;
    sha256?: string;
    size?: number;
  }): Promise<void>;
  recordRecoveryConflict(input: {
    checkpointId: string;
    path: string;
    reason: string;
  }): Promise<CheckpointRecoveryConflict>;
  clearRecoveryConflict(checkpointId: string, path: string): Promise<void>;
  listRecoveryConflicts(checkpointId: string): CheckpointRecoveryConflict[];
  getWriteSnapshot(checkpointId: string, path: string): WriteSnapshotRecord | undefined;
}
