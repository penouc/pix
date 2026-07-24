import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopDatabase } from './desktop-database.js';

describe('SqliteCheckpointRepository', () => {
  let dir: string | undefined;
  let database: DesktopDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('persists baseline files before atomically attaching a running agent run', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pi-checkpoint-db-'));
    database = DesktopDatabase.open(path.join(dir, 'desktop.sqlite'));
    await database.projects.put({
      id: 'project-1',
      path: '/workspace',
      name: 'Workspace',
      trusted: true,
      isGit: true,
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
      workspacePath: '/workspace',
      isGit: true,
      headOid: 'a'.repeat(40),
      indexTreeOid: 'b'.repeat(40),
      statusPorcelain: Buffer.from(' M edited.ts\0'),
      files: [
        {
          path: 'edited.ts',
          status: ' M',
          exists: true,
          sha256: 'c'.repeat(64),
        },
      ],
      createdAt: 10,
    });

    expect(database.checkpoints.get('checkpoint-1')).toMatchObject({
      state: 'captured',
      files: [{ path: 'edited.ts', sha256: 'c'.repeat(64) }],
    });
    expect(database.checkpoints.getRun('run-1')).toBeUndefined();

    await database.checkpoints.attachRun({
      checkpointId: 'checkpoint-1',
      runId: 'run-1',
      projectId: 'project-1',
      sessionId: 'session-1',
    });

    expect(database.checkpoints.get('checkpoint-1')).toMatchObject({
      state: 'running',
      runId: 'run-1',
    });
    expect(database.checkpoints.getRun('run-1')).toMatchObject({
      checkpointId: 'checkpoint-1',
      status: 'running',
    });
    expect(database.checkpoints.getCheckpointForRun('run-1')).toMatchObject({
      id: 'checkpoint-1',
    });
    await database.checkpoints.setReviewOutcome('checkpoint-1', 'kept');
    expect(database.checkpoints.get('checkpoint-1')).toMatchObject({
      reviewOutcome: 'kept',
    });
  });

  it('discards an unattached checkpoint so failed sends cannot be reverted', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pi-checkpoint-db-'));
    database = DesktopDatabase.open(path.join(dir, 'desktop.sqlite'));
    await database.projects.put({
      id: 'project-1',
      path: '/workspace',
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
      id: 'checkpoint-2',
      projectId: 'project-1',
      sessionId: 'session-1',
      workspacePath: '/workspace',
      isGit: false,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    });

    await database.checkpoints.discard('checkpoint-2');

    expect(database.checkpoints.get('checkpoint-2')).toBeUndefined();
  });

  it('stores exact first-write bytes once and represents absent files without content', async () => {
    database = DesktopDatabase.open(':memory:');
    await database.projects.put({
      id: 'project-1',
      path: '/workspace',
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
      id: 'checkpoint-3',
      projectId: 'project-1',
      sessionId: 'session-1',
      workspacePath: '/workspace',
      isGit: false,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    });
    const original = Buffer.from([0, 255, 10]);
    await database.checkpoints.storeWriteSnapshot({
      checkpointId: 'checkpoint-3',
      path: 'existing.bin',
      existedBefore: true,
      content: original,
      sha256: 'a'.repeat(64),
      size: original.length,
      createdAt: 1,
    });
    await database.checkpoints.storeWriteSnapshot({
      checkpointId: 'checkpoint-3',
      path: 'existing.bin',
      existedBefore: true,
      content: Buffer.from('changed'),
      sha256: 'b'.repeat(64),
      size: 7,
      createdAt: 2,
    });
    await database.checkpoints.storeWriteSnapshot({
      checkpointId: 'checkpoint-3',
      path: 'new.txt',
      existedBefore: false,
    });

    expect(database.checkpoints.getWriteSnapshot('checkpoint-3', 'existing.bin')).toMatchObject({
      content: original,
      sha256: 'a'.repeat(64),
      size: 3,
      createdAt: 1,
    });
    expect(database.checkpoints.getWriteSnapshot('checkpoint-3', 'new.txt')).toMatchObject({
      existedBefore: false,
      content: undefined,
      sha256: undefined,
      size: undefined,
    });
  });

  it('discovers unresolved running checkpoints and retains them when cleaning old resolved snapshots', async () => {
    database = DesktopDatabase.open(':memory:');
    await database.projects.put({
      id: 'project-1',
      path: '/workspace',
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
    for (const id of ['resolved-old', 'unresolved-old', 'resolved-recent']) {
      await database.checkpoints.createBaseline({
        id,
        projectId: 'project-1',
        sessionId: 'session-1',
        workspacePath: '/workspace',
        isGit: false,
        statusPorcelain: Buffer.alloc(0),
        files: [],
        createdAt: id === 'resolved-recent' ? 200 : 10,
      });
      await database.checkpoints.attachRun({
        checkpointId: id,
        runId: `run-${id}`,
        projectId: 'project-1',
        sessionId: 'session-1',
      });
      await database.checkpoints.storeWriteSnapshot({
        checkpointId: id,
        path: 'agent.txt',
        existedBefore: false,
      });
    }
    await database.checkpoints.setReviewOutcome('resolved-old', 'kept');
    await database.checkpoints.setReviewOutcome('resolved-recent', 'reverted');

    expect(database.checkpoints.listRecoverable().map((checkpoint) => checkpoint.id)).toEqual([
      'unresolved-old',
    ]);

    await expect(database.checkpoints.cleanupResolved(100)).resolves.toEqual({
      deletedCheckpoints: 1,
    });
    expect(database.checkpoints.get('resolved-old')).toBeUndefined();
    expect(database.checkpoints.getWriteSnapshot('resolved-old', 'agent.txt')).toBeUndefined();
    expect(database.checkpoints.get('unresolved-old')).toBeDefined();
    expect(database.checkpoints.getWriteSnapshot('unresolved-old', 'agent.txt')).toBeDefined();
    expect(database.checkpoints.get('resolved-recent')).toBeDefined();
  });
});
