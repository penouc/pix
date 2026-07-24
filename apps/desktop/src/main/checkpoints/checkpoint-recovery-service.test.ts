import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DesktopDatabase } from '@pi-desktop/database';
import { afterEach, describe, expect, it } from 'vitest';

import { CheckpointRecoveryService } from './checkpoint-recovery-service.js';

describe('CheckpointRecoveryService', () => {
  let directory: string | undefined;
  let database: DesktopDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('restores agent-produced matching files and removes unchanged agent-created files', async () => {
    const { recovery, workspace } = await createRecovery();
    const original = Buffer.from([0, 255, 10]);
    await writeFile(path.join(workspace, 'existing.bin'), original);
    await writeFile(path.join(workspace, 'unrelated.txt'), 'do not touch');
    await snapshot('existing.bin', true, original);
    await snapshot('new.txt', false);

    await writeFile(path.join(workspace, 'existing.bin'), 'agent overwrite');
    await writeFile(path.join(workspace, 'new.txt'), 'agent-created');
    await expected('existing.bin', 'agent overwrite');
    await expected('new.txt', 'agent-created');

    await expect(recovery.revertAll('run-1')).resolves.toEqual({ outcome: 'reverted', conflicts: [] });

    await expect(readFile(path.join(workspace, 'existing.bin'))).resolves.toEqual(original);
    await expect(readFile(path.join(workspace, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(workspace, 'unrelated.txt'), 'utf8')).resolves.toBe('do not touch');
  });

  it('blocks restoring a file changed by the user after the agent write', async () => {
    const { recovery, workspace } = await createRecovery();
    await writeFile(path.join(workspace, 'file.txt'), 'before');
    await snapshot('file.txt', true, Buffer.from('before'));
    await writeFile(path.join(workspace, 'file.txt'), 'agent');
    await expected('file.txt', 'agent');
    await writeFile(path.join(workspace, 'file.txt'), 'user change');

    await expect(recovery.revertFile('run-1', 'file.txt')).resolves.toMatchObject({
      outcome: 'conflicted',
      conflicts: [{ path: 'file.txt', reason: expect.stringMatching(/no automatic overwrite/) }],
    });
    await expect(readFile(path.join(workspace, 'file.txt'), 'utf8')).resolves.toBe('user change');
  });

  it('blocks deleting an agent-created file changed by the user', async () => {
    const { recovery, workspace } = await createRecovery();
    await snapshot('new.txt', false);
    await writeFile(path.join(workspace, 'new.txt'), 'agent-created');
    await expected('new.txt', 'agent-created');
    await writeFile(path.join(workspace, 'new.txt'), 'user change');

    await expect(recovery.revertFile('run-1', 'new.txt')).resolves.toMatchObject({
      outcome: 'conflicted',
    });
    await expect(readFile(path.join(workspace, 'new.txt'), 'utf8')).resolves.toBe('user change');
  });

  it('reverts non-conflicting files and reports conflicts from revertAll', async () => {
    const { recovery, workspace } = await createRecovery();
    await writeFile(path.join(workspace, 'restore.txt'), 'before');
    await snapshot('restore.txt', true, Buffer.from('before'));
    await snapshot('conflict.txt', false);
    await writeFile(path.join(workspace, 'restore.txt'), 'agent');
    await writeFile(path.join(workspace, 'conflict.txt'), 'agent');
    await expected('restore.txt', 'agent');
    await expected('conflict.txt', 'agent');
    await writeFile(path.join(workspace, 'conflict.txt'), 'user change');

    await expect(recovery.revertAll('run-1')).resolves.toMatchObject({
      outcome: 'conflicted',
      conflicts: [{ path: 'conflict.txt' }],
    });
    await expect(readFile(path.join(workspace, 'restore.txt'), 'utf8')).resolves.toBe('before');
    await expect(readFile(path.join(workspace, 'conflict.txt'), 'utf8')).resolves.toBe('user change');
    await expect(recovery.review('run-1')).resolves.toMatchObject({
      conflicts: [{ path: 'conflict.txt' }],
    });
  });

  it('rejects a persisted path escape without touching the outside file', async () => {
    const { recovery, workspace } = await createRecovery();
    const outside = path.join(path.dirname(workspace), 'outside.txt');
    await writeFile(outside, 'outside');
    await snapshot('../outside.txt', true, Buffer.from('original'));

    await expect(recovery.revertFile('run-1', '../outside.txt')).rejects.toThrow(/escapes workspace/);
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside');
  });

  async function createRecovery() {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-checkpoint-recovery-'));
    const workspace = path.join(directory, 'workspace');
    await mkdir(workspace);
    database = DesktopDatabase.open(path.join(directory, 'desktop.sqlite'));
    await database.projects.put({
      id: 'project-1',
      path: workspace,
      name: 'Workspace',
      trusted: true,
      isGit: false,
      lastOpenedAt: 1,
    });
    await database.sessions.put({
      id: 'session-1',
      projectId: 'project-1',
      title: 'Session',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    await database.checkpoints.createBaseline({
      id: 'checkpoint-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      workspacePath: workspace,
      isGit: false,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    });
    await database.checkpoints.attachRun({
      checkpointId: 'checkpoint-1',
      runId: 'run-1',
      projectId: 'project-1',
      sessionId: 'session-1',
    });
    return { recovery: new CheckpointRecoveryService(database.checkpoints), workspace };
  }

  async function snapshot(pathname: string, existedBefore: boolean, content?: Buffer) {
    if (!database) throw new Error('Database is not ready');
    await database.checkpoints.storeWriteSnapshot({
      checkpointId: 'checkpoint-1',
      path: pathname,
      existedBefore,
      ...(content
        ? {
            content,
            sha256: createHash('sha256').update(content).digest('hex'),
            size: content.length,
          }
        : {}),
    });
  }

  async function expected(pathname: string, content: string | Buffer) {
    if (!database) throw new Error('Database is not ready');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await database.checkpoints.setExpectedWriteState({
      checkpointId: 'checkpoint-1',
      path: pathname,
      exists: true,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
  }
});
