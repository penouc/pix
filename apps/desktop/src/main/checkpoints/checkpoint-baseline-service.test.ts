import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { captureCheckpointBaseline } from './checkpoint-baseline-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRepository(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pi-checkpoint-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '--quiet', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Fixture']);
  writeFileSync(path.join(dir, 'tracked.txt'), 'before\n');
  execFileSync('git', ['-C', dir, 'add', 'tracked.txt']);
  execFileSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'initial']);
  return dir;
}

describe('captureCheckpointBaseline', () => {
  it('records clean Git HEAD and index state with no dirty files', async () => {
    const repo = createRepository();
    const expectedHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    const baseline = await captureCheckpointBaseline(repo);

    expect(baseline).toMatchObject({
      isGit: true,
      headOid: expectedHead,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    });
    expect(baseline.indexTreeOid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('records exact status plus hashes for modified and untracked files', async () => {
    const repo = createRepository();
    writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');
    writeFileSync(path.join(repo, 'new.txt'), 'new\n');

    const baseline = await captureCheckpointBaseline(repo);

    expect(baseline.statusPorcelain.toString('utf8')).toBe(' M tracked.txt\0?? new.txt\0');
    expect(baseline.files).toEqual(
      expect.arrayContaining([
        {
          path: 'tracked.txt',
          status: ' M',
          exists: true,
          sha256: sha256('changed\n'),
        },
        {
          path: 'new.txt',
          status: '??',
          exists: true,
          sha256: sha256('new\n'),
        },
      ]),
    );
  });

  it('records deleted files as absent without attempting to hash them', async () => {
    const repo = createRepository();
    rmSync(path.join(repo, 'tracked.txt'));

    const baseline = await captureCheckpointBaseline(repo);

    expect(baseline.files).toContainEqual({
      path: 'tracked.txt',
      status: ' D',
      exists: false,
    });
  });

  it('creates a non-Git baseline without invoking Git state persistence', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'pi-checkpoint-non-git-'));
    tempDirs.push(directory);

    await expect(captureCheckpointBaseline(directory)).resolves.toMatchObject({
      workspacePath: expect.stringContaining(path.basename(directory)),
      isGit: false,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    });
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
