import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getWorkingTreeDiff } from './git-diff-service.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await removeWithRetry(tempDir);
  }
});

/**
 * Windows: a git child killed for exceeding maxBuffer can still hold the repo
 * directory for a tick after the promise settles, so plain rmSync hits EBUSY.
 */
async function removeWithRetry(target: string, attempts = 8): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
  }
}

function createRepository(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-git-diff-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '--quiet', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Fixture']);
  writeFileSync(path.join(dir, 'file.txt'), 'before\n');
  writeFileSync(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 0]));
  execFileSync('git', ['-C', dir, 'add', 'file.txt', 'binary.bin']);
  execFileSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'initial']);
  return dir;
}

describe('getWorkingTreeDiff', () => {
  it('returns a read-only HEAD diff for tracked changes', async () => {
    const repo = createRepository();
    writeFileSync(path.join(repo, 'file.txt'), 'after\n');

    await expect(getWorkingTreeDiff('project-1', repo)).resolves.toMatchObject({
      projectId: 'project-1',
      truncated: false,
      patch: expect.stringContaining('before'),
    });
  });

  it('returns an empty patch when the working tree is clean', async () => {
    await expect(getWorkingTreeDiff('project-1', createRepository())).resolves.toMatchObject({
      patch: '',
      truncated: false,
    });
  });

  it('reports added, deleted, renamed, and binary files', async () => {
    const repo = createRepository();
    execFileSync('git', ['-C', repo, 'mv', 'file.txt', 'renamed.txt']);
    writeFileSync(path.join(repo, 'added.txt'), 'added\n');
    writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    execFileSync('git', ['-C', repo, 'add', 'added.txt']);

    const result = await getWorkingTreeDiff('project-1', repo);
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'renamed.txt',
          previousPath: 'file.txt',
          status: 'renamed',
        }),
        expect.objectContaining({ path: 'added.txt', status: 'added' }),
        expect.objectContaining({ path: 'binary.bin', binary: true }),
      ]),
    );
  });

  it('rejects a diff beyond the review output limit', async () => {
    const repo = createRepository();
    writeFileSync(path.join(repo, 'file.txt'), 'x'.repeat(1_100_000));

    await expect(getWorkingTreeDiff('project-1', repo)).rejects.toMatchObject({
      code: 'GIT_DIFF_TOO_LARGE',
    });
  });
});
