import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TerminalService } from './terminal-service.js';

describe('TerminalService.changeDirectory', () => {
  let root: string;
  let outside: string;
  let service: TerminalService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-term-'));
    outside = await mkdtemp(path.join(tmpdir(), 'pi-out-'));
    await mkdir(path.join(root, 'packages', 'security'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), '# hi\n');
    service = new TerminalService({ requestApproval: () => {} });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('descends into a subdirectory and reports it relative to the root', async () => {
    const result = await service.changeDirectory({
      workspaceRoot: root,
      target: 'packages/security',
    });

    expect(result.outcome).toBe('changed');
    expect(result.relative).toBe('packages/security');
    // Canonical, so symlinks in the root are already resolved.
    expect(result.cwd).toBe(path.join(realpathSync(root), 'packages', 'security'));
  });

  it('resolves the next target against the current directory', async () => {
    const result = await service.changeDirectory({
      workspaceRoot: root,
      cwd: path.join(root, 'packages'),
      target: 'security',
    });

    expect(result.relative).toBe('packages/security');
  });

  it('treats a bare cd and ~ as the project root', async () => {
    for (const target of ['', '~']) {
      const result = await service.changeDirectory({
        workspaceRoot: root,
        cwd: path.join(root, 'packages'),
        target,
      });
      expect(result.outcome).toBe('changed');
      expect(result.relative).toBe('.');
    }
  });

  it('goes up to the root but no further', async () => {
    const up = await service.changeDirectory({
      workspaceRoot: root,
      cwd: path.join(root, 'packages'),
      target: '..',
    });
    expect(up.outcome).toBe('changed');
    expect(up.relative).toBe('.');
  });

  it('refuses to leave the workspace and stays where it was', async () => {
    const cwd = path.join(root, 'packages');

    for (const target of ['../..', '../../..', outside, '/etc', '/']) {
      const result = await service.changeDirectory({ workspaceRoot: root, cwd, target });
      expect(result.outcome, target).toBe('refused');
      // The tab must not move on a refusal, or the next command runs somewhere
      // the user did not choose.
      expect(result.cwd, target).toBe(path.join(realpathSync(root), 'packages'));
      expect(result.reason, target).toMatch(/outside the project root/);
    }
  });

  it('refuses a symlink that points out of the workspace', async () => {
    await symlink(outside, path.join(root, 'escape-hatch'));

    const result = await service.changeDirectory({ workspaceRoot: root, target: 'escape-hatch' });

    expect(result.outcome).toBe('refused');
  });

  it('refuses a file and a missing path with distinct reasons', async () => {
    const file = await service.changeDirectory({ workspaceRoot: root, target: 'README.md' });
    expect(file.outcome).toBe('refused');
    expect(file.reason).toMatch(/Not a directory/);

    const missing = await service.changeDirectory({ workspaceRoot: root, target: 'nope' });
    expect(missing.outcome).toBe('refused');
    expect(missing.reason).toMatch(/No such directory/);
  });

  it('accepts a quoted target', async () => {
    const result = await service.changeDirectory({
      workspaceRoot: root,
      target: '"packages/security"',
    });
    expect(result.relative).toBe('packages/security');
  });
});

describe('TerminalService.exec cwd', () => {
  let root: string;
  let service: TerminalService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-term-exec-'));
    await mkdir(path.join(root, 'sub'), { recursive: true });
    service = new TerminalService({ requestApproval: () => {} });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs the command in the directory the tab is in', async () => {
    const result = await service.exec({
      projectId: 'p1',
      workspaceRoot: root,
      projectTrusted: true,
      command: 'pwd',
      cwd: path.join(root, 'sub'),
    });

    expect(result.outcome).toBe('ran');
    // macOS reports /private/var for /var, so compare the tail.
    expect(result.output.trim().endsWith('/sub')).toBe(true);
  });

  it('refuses a cwd outside the workspace before spawning anything', async () => {
    const result = await service.exec({
      projectId: 'p1',
      workspaceRoot: root,
      projectTrusted: true,
      command: 'pwd',
      cwd: '/etc',
    });

    expect(result.outcome).toBe('denied');
    expect(result.output).toBe('');
  });

  it('refuses an ancestor of the project root', async () => {
    // Regression: the confinement check had its arguments reversed, so it asked
    // whether the root was inside the requested directory. Every ancestor —
    // including `/` and the user's home — passed, and the command ran outside
    // the workspace.
    for (const cwd of [path.dirname(root), '/']) {
      const result = await service.exec({
        projectId: 'p1',
        workspaceRoot: root,
        projectTrusted: true,
        command: 'pwd',
        cwd,
      });
      expect(result.outcome, cwd).toBe('denied');
    }
  });
});
