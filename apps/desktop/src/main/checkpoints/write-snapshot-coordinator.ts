import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { CheckpointRepository, WriteSnapshotRecord } from '@pi-desktop/database';

interface RunSnapshotContext {
  checkpointId: string;
  workspacePath: string;
}

/**
 * Main-owned bridge between an active agent run and immutable pre-write bytes.
 * Paths are persisted workspace-relative and are rejected unless their resolved
 * target (or existing parent for a new file) remains within the workspace.
 */
export class WriteSnapshotCoordinator {
  private readonly runs = new Map<string, RunSnapshotContext>();

  constructor(private readonly checkpoints: CheckpointRepository) {}

  associateRun(runId: string, checkpointId: string, workspacePath: string): void {
    this.runs.set(runId, { checkpointId, workspacePath });
  }

  async snapshotBeforeWrite(runId: string, toolPath: string): Promise<WriteSnapshotRecord> {
    const context = this.runs.get(runId);
    if (!context) {
      throw new Error(`No checkpoint snapshot context for agent run ${runId}`);
    }
    const { relativePath, absolutePath } = await resolveWorkspacePath(context.workspacePath, toolPath);
    const existing = this.checkpoints.getWriteSnapshot(context.checkpointId, relativePath);
    if (existing) return existing;

    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Refusing to snapshot non-regular file: ${relativePath}`);
      }
      const realFile = await realpath(absolutePath);
      ensureInsideWorkspace(await realpath(context.workspacePath), realFile);
      const content = await readFile(absolutePath);
      return this.checkpoints.storeWriteSnapshot({
        checkpointId: context.checkpointId,
        path: relativePath,
        existedBefore: true,
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.length,
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
      await ensureNewFileParentInsideWorkspace(context.workspacePath, absolutePath);
      return this.checkpoints.storeWriteSnapshot({
        checkpointId: context.checkpointId,
        path: relativePath,
        existedBefore: false,
      });
    }
  }

  async recordExpectedStateAfterWrite(runId: string, toolPath: string): Promise<void> {
    const context = this.runs.get(runId);
    if (!context) {
      throw new Error(`No checkpoint snapshot context for agent run ${runId}`);
    }
    const { relativePath, absolutePath } = await resolveWorkspacePath(context.workspacePath, toolPath);
    if (!this.checkpoints.getWriteSnapshot(context.checkpointId, relativePath)) {
      throw new Error(`No write snapshot exists for ${relativePath}`);
    }
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Refusing to record non-regular expected state: ${relativePath}`);
      }
      const realFile = await realpath(absolutePath);
      ensureInsideWorkspace(await realpath(context.workspacePath), realFile);
      const content = await readFile(absolutePath);
      await this.checkpoints.setExpectedWriteState({
        checkpointId: context.checkpointId,
        path: relativePath,
        exists: true,
        sha256: createHash('sha256').update(content).digest('hex'),
        size: content.length,
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.checkpoints.setExpectedWriteState({
        checkpointId: context.checkpointId,
        path: relativePath,
        exists: false,
      });
    }
  }
}

async function resolveWorkspacePath(
  workspacePath: string,
  toolPath: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  if (!toolPath || toolPath.includes('\0')) throw new Error('Write tool path is invalid');
  const workspace = await realpath(workspacePath);
  const absolutePath = path.isAbsolute(toolPath)
    ? path.resolve(toolPath)
    : path.resolve(workspace, toolPath);
  ensureInsideWorkspace(workspace, absolutePath);
  const relativePath = path.relative(workspace, absolutePath);
  if (!relativePath || relativePath.split(path.sep).some((segment) => segment === '..')) {
    throw new Error('Write tool path must name a workspace-relative file');
  }
  return { relativePath, absolutePath };
}

async function ensureNewFileParentInsideWorkspace(
  workspacePath: string,
  candidate: string,
): Promise<void> {
  const workspace = await realpath(workspacePath);
  const parent = await realpath(path.dirname(candidate));
  ensureInsideWorkspace(workspace, parent);
}

function ensureInsideWorkspace(workspace: string, candidate: string): void {
  if (candidate !== workspace && !candidate.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Write tool path escapes workspace: ${candidate}`);
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
