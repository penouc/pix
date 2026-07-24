import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CheckpointCleanupResult,
  CheckpointRepository,
  CheckpointSummary,
  WriteSnapshotRecord,
} from '@pi-desktop/database';

export interface RecoveryConflict {
  path: string;
  reason: string;
}

export interface RecoveryResult {
  outcome: 'reverted' | 'conflicted';
  conflicts: RecoveryConflict[];
}

/**
 * Restores only immutable first-write snapshots. It deliberately does not use
 * Git and refuses paths whose current filesystem shape is unsafe to modify.
 */
export class CheckpointRecoveryService {
  constructor(private readonly checkpoints: CheckpointRepository) {}

  async review(runId: string): Promise<{
    paths: string[];
    outcome?: string;
    conflicts: RecoveryConflict[];
  }> {
    const checkpoint = this.requireCheckpoint(runId);
    return {
      paths: this.checkpoints.listWriteSnapshots(checkpoint.id).map((snapshot) => snapshot.path),
      outcome: checkpoint.reviewOutcome,
      conflicts: this.checkpoints.listRecoveryConflicts(checkpoint.id).map(({ path, reason }) => ({
        path,
        reason,
      })),
    };
  }

  listRecoverable(): CheckpointSummary[] {
    return this.checkpoints.listRecoverable();
  }

  async cleanupResolved(before: number): Promise<CheckpointCleanupResult> {
    return this.checkpoints.cleanupResolved(before);
  }

  async keep(runId: string): Promise<void> {
    await this.checkpoints.setReviewOutcome(this.requireCheckpoint(runId).id, 'kept');
  }

  async continue(runId: string): Promise<void> {
    await this.checkpoints.setReviewOutcome(this.requireCheckpoint(runId).id, 'continued');
  }

  async revertFile(runId: string, snapshotPath: string): Promise<RecoveryResult> {
    const checkpoint = this.requireCheckpoint(runId);
    const snapshot = this.checkpoints.getWriteSnapshot(checkpoint.id, snapshotPath);
    if (!snapshot) throw new Error(`No write snapshot for ${snapshotPath}`);
    const conflict = await restoreSnapshot(checkpoint.workspacePath, snapshot);
    if (conflict) {
      await this.checkpoints.recordRecoveryConflict({
        checkpointId: checkpoint.id,
        path: conflict.path,
        reason: conflict.reason,
      });
      return { outcome: 'conflicted', conflicts: [conflict] };
    }
    await this.checkpoints.clearRecoveryConflict(checkpoint.id, snapshot.path);
    return { outcome: 'reverted', conflicts: [] };
  }

  async revertAll(runId: string): Promise<RecoveryResult> {
    const checkpoint = this.requireCheckpoint(runId);
    const conflicts: RecoveryConflict[] = [];
    for (const snapshot of this.checkpoints.listWriteSnapshots(checkpoint.id)) {
      const conflict = await restoreSnapshot(checkpoint.workspacePath, snapshot);
      if (conflict) {
        conflicts.push(conflict);
        await this.checkpoints.recordRecoveryConflict({
          checkpointId: checkpoint.id,
          path: conflict.path,
          reason: conflict.reason,
        });
      } else {
        await this.checkpoints.clearRecoveryConflict(checkpoint.id, snapshot.path);
      }
    }
    if (conflicts.length === 0) {
      await this.checkpoints.setReviewOutcome(checkpoint.id, 'reverted');
    }
    return { outcome: conflicts.length > 0 ? 'conflicted' : 'reverted', conflicts };
  }

  private requireCheckpoint(runId: string) {
    const checkpoint = this.checkpoints.getCheckpointForRun(runId);
    if (!checkpoint) throw new Error(`No checkpoint exists for agent run ${runId}`);
    return checkpoint;
  }
}

async function restoreSnapshot(
  workspacePath: string,
  snapshot: WriteSnapshotRecord,
): Promise<RecoveryConflict | undefined> {
  const { workspace, target } = await resolveSnapshotPath(workspacePath, snapshot.path);
  await ensureSafeParents(workspace, target);

  let targetStat: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    targetStat = await lstat(target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  if (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) {
    throw new Error(`Refusing to modify non-regular file: ${snapshot.path}`);
  }
  const conflict = await expectedStateConflict(snapshot, target, targetStat);
  if (conflict) return conflict;

  if (snapshot.existedBefore) {
    if (!snapshot.content) throw new Error(`Snapshot content is missing for ${snapshot.path}`);
    await writeFile(target, snapshot.content);
  } else if (targetStat) {
    await unlink(target);
  }
}

async function expectedStateConflict(
  snapshot: WriteSnapshotRecord,
  target: string,
  targetStat: Awaited<ReturnType<typeof lstat>> | undefined,
): Promise<RecoveryConflict | undefined> {
  if (snapshot.expectedExists === undefined) {
    return {
      path: snapshot.path,
      reason: 'The agent post-write state was not recorded, so no automatic overwrite occurred.',
    };
  }
  if (snapshot.expectedExists !== Boolean(targetStat)) {
    return {
      path: snapshot.path,
      reason: 'The file existence changed after the agent write, so no automatic overwrite occurred.',
    };
  }
  if (!targetStat) return undefined;
  const content = await readFile(target);
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (snapshot.expectedSha256 !== sha256 || snapshot.expectedSize !== content.length) {
    return {
      path: snapshot.path,
      reason: 'The file content changed after the agent write, so no automatic overwrite occurred.',
    };
  }
  return undefined;
}

async function resolveSnapshotPath(
  workspacePath: string,
  snapshotPath: string,
): Promise<{ workspace: string; target: string }> {
  if (!snapshotPath || snapshotPath.includes('\0') || path.isAbsolute(snapshotPath)) {
    throw new Error('Snapshot path is invalid');
  }
  const workspace = await realpath(workspacePath);
  const target = path.resolve(workspace, snapshotPath);
  if (target === workspace || !target.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Snapshot path escapes workspace: ${snapshotPath}`);
  }
  return { workspace, target };
}

async function ensureSafeParents(workspace: string, target: string): Promise<void> {
  const relativeParent = path.relative(workspace, path.dirname(target));
  let current = workspace;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (isMissing(error)) {
        throw new Error(`Refusing to restore through missing parent: ${relativeParent}`);
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Refusing to restore through unsafe parent: ${relativeParent}`);
    }
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
