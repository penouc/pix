import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DesktopDatabase } from '@pi-desktop/database';
import { afterEach, describe, expect, it } from 'vitest';

import { WriteSnapshotCoordinator } from './write-snapshot-coordinator.js';

describe('WriteSnapshotCoordinator', () => {
  let directory: string | undefined;
  let database: DesktopDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('captures exact existing bytes once, records missing files, and rejects escapes', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-write-snapshot-'));
    const workspace = path.join(directory, 'workspace');
    await writeFile(path.join(directory, 'outside.txt'), 'outside');
    await mkdir(workspace);
    const original = Buffer.from([0, 255, 10]);
    await writeFile(path.join(workspace, 'existing.bin'), original);

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
    const coordinator = new WriteSnapshotCoordinator(database.checkpoints);
    coordinator.associateRun('run-1', 'checkpoint-1', workspace);

    const snapshot = await coordinator.snapshotBeforeWrite('run-1', 'existing.bin');
    await writeFile(path.join(workspace, 'existing.bin'), 'changed');
    const repeated = await coordinator.snapshotBeforeWrite('run-1', 'existing.bin');
    const missing = await coordinator.snapshotBeforeWrite('run-1', 'new.txt');

    expect(snapshot).toMatchObject({
      existedBefore: true,
      content: original,
      sha256: createHash('sha256').update(original).digest('hex'),
      size: original.length,
    });
    expect(repeated).toEqual(snapshot);
    expect(missing).toMatchObject({
      path: 'new.txt',
      existedBefore: false,
      content: undefined,
      sha256: undefined,
      size: undefined,
    });
    await expect(coordinator.snapshotBeforeWrite('run-1', '../outside.txt')).rejects.toThrow(
      /escapes workspace/,
    );
  });

  it('records expected state only when a successful write completion is reported', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-write-expected-state-'));
    const workspace = path.join(directory, 'workspace');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'file.txt'), 'before');
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
    const coordinator = new WriteSnapshotCoordinator(database.checkpoints);
    coordinator.associateRun('run-1', 'checkpoint-1', workspace);
    await coordinator.snapshotBeforeWrite('run-1', 'file.txt');

    // A failed tool never calls the completion hook and therefore cannot
    // publish a false agent-produced state.
    expect(
      database.checkpoints.getWriteSnapshot('checkpoint-1', 'file.txt')?.expectedExists,
    ).toBeUndefined();
    await writeFile(path.join(workspace, 'file.txt'), 'agent write');
    await coordinator.recordExpectedStateAfterWrite('run-1', 'file.txt');

    expect(database.checkpoints.getWriteSnapshot('checkpoint-1', 'file.txt')).toMatchObject({
      expectedExists: true,
      expectedSha256: createHash('sha256').update('agent write').digest('hex'),
      expectedSize: 11,
    });
  });
});
