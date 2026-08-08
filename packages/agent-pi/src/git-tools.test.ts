import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createGitCommitTool,
  createGitDiffTool,
  createGitLogTool,
  createGitStatusTool,
  getGitDiff,
  parseGitStatus,
} from './git-tools.js';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function writeFile(rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'pix-git-tools-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFile('a.txt', 'alpha\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

async function runTool(tool: unknown, params: unknown) {
  // The SDK's ToolDefinition execute is contravariant in its params, so a
  // structural signature cannot accept every tool — narrow with a cast.
  const execute = (tool as { execute: (...args: unknown[]) => Promise<unknown> }).execute;
  return execute('call-1', params, undefined, undefined, { cwd: repo }) as Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  }>;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('parseGitStatus', () => {
  it('parses a clean branch header', () => {
    const result = parseGitStatus('## main\n\0');
    expect(result.branch).toBe('main');
    expect(result.entries).toEqual([]);
  });

  it('parses ahead/behind', () => {
    const result = parseGitStatus('## main...origin/main [ahead 2, behind 1]\n\0');
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(1);
  });

  it('parses staged/modified/untracked entries', () => {
    const result = parseGitStatus('## main\n\0M  a.txt\0 M b.txt\0?? c.txt\0');
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toMatchObject({ path: 'a.txt', staged: true, untracked: false });
    expect(result.entries[1]).toMatchObject({ path: 'b.txt', staged: false, untracked: false });
    expect(result.entries[2]).toMatchObject({ path: 'c.txt', staged: false, untracked: true });
    expect(result.stagedCount).toBe(1);
    expect(result.unstagedCount).toBe(1);
    expect(result.untrackedCount).toBe(1);
  });

  it('pairs rename source+target', () => {
    const result = parseGitStatus('## main\n\0R  old.txt\0new.txt\0');
    expect(result.entries[0]).toMatchObject({
      path: 'new.txt',
      previousPath: 'old.txt',
      xy: 'R ',
    });
  });
});

describe('git_status tool', () => {
  it('reports a clean tree', async () => {
    const tool = createGitStatusTool();
    const result = await runTool(tool, {});
    expect(textOf(result)).toContain('Working tree clean');
    expect((result.details as { entries?: unknown[] } | undefined)?.entries).toEqual([]);
  });

  it('reports modified + untracked', async () => {
    writeFile('a.txt', 'alpha changed\n');
    writeFile('new.txt', 'hello\n');
    const tool = createGitStatusTool();
    const result = await runTool(tool, {});
    const details = result.details as {
      stagedCount?: number;
      unstagedCount?: number;
      untrackedCount?: number;
    };
    expect(details.stagedCount).toBe(0);
    expect(details.unstagedCount).toBe(1);
    expect(details.untrackedCount).toBe(1);
    const text = textOf(result);
    expect(text).toContain('a.txt');
    expect(text).toContain('new.txt');
  });
});

describe('git_diff tool', () => {
  it('returns patch + file list for working-tree changes', async () => {
    writeFile('a.txt', 'alpha\nbeta\n');
    const result = await getGitDiff(repo);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ path: 'a.txt', status: 'modified', binary: false });
    expect(result.patch).toContain('+beta');
    expect(result.truncated).toBe(false);
  });

  it('respects staged-only mode', async () => {
    writeFile('a.txt', 'alpha\nbeta\n');
    git(['add', 'a.txt']);
    const tool = createGitDiffTool();
    const staged = await runTool(tool, { staged: true });
    const stagedFiles = (staged.details as { files?: Array<{ path: string }> } | undefined)?.files;
    expect(stagedFiles?.[0]?.path).toBe('a.txt');
    // Default (vs HEAD) includes staged changes too — same as the Diff panel.
    const working = await runTool(tool, {});
    const workingFiles = (working.details as { files?: Array<{ path: string }> } | undefined)
      ?.files;
    expect(workingFiles?.[0]?.path).toBe('a.txt');
  });

  it('reports added and deleted files', async () => {
    // A staged new file reads as `added` vs HEAD; a staged removal as `deleted`.
    writeFile('added.txt', 'x\n');
    writeFile('del.txt', 'gone\n');
    git(['add', 'added.txt', 'del.txt']);
    git(['commit', '-q', '-m', 'tmp']);
    writeFile('del.txt', 'gone\nchanged\n');
    git(['add', 'del.txt']);
    git(['commit', '-q', '-m', 'tmp2']);
    git(['rm', '-q', 'del.txt']);
    writeFile('added2.txt', 'y\n');
    git(['add', 'added2.txt']);
    const result = await getGitDiff(repo);
    const statuses = result.files.map((f) => f.status).sort();
    expect(statuses).toEqual(['added', 'deleted']);
  });
});

describe('git_log tool', () => {
  it('lists recent commits newest first', async () => {
    writeFile('b.txt', 'x\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: second']);
    const tool = createGitLogTool();
    const result = await runTool(tool, { limit: 5 });
    const commits = (result.details as { commits?: string[] } | undefined)?.commits ?? [];
    expect(commits.length).toBe(2);
    expect(commits[0]).toContain('feat: second');
    expect(commits[1]).toContain('feat: initial');
  });
});

describe('git_commit tool (#17)', () => {
  it('stages and commits everything by default', async () => {
    writeFile('a.txt', 'alpha\nbeta\n');
    const tool = createGitCommitTool();
    const result = await runTool(tool, { message: 'feat: add beta' });
    const details = result.details as { committed?: boolean; hash?: string };
    expect(details.committed).toBe(true);
    expect(details.hash).toBeTruthy();
    const log = git(['log', '--oneline']);
    expect(log).toContain('feat: add beta');
  });

  it('commits only the given files', async () => {
    writeFile('a.txt', 'alpha\nbeta\n');
    writeFile('other.txt', 'untouched\n');
    const tool = createGitCommitTool();
    const result = await runTool(tool, { message: 'fix: a only', files: ['a.txt'] });
    expect((result.details as { committed?: boolean }).committed).toBe(true);
    const log = git(['log', '--oneline', '--stat']);
    expect(log).toContain('a.txt');
    expect(log).not.toContain('other.txt');
  });

  it('rejects an empty message', async () => {
    const tool = createGitCommitTool();
    const result = await runTool(tool, { message: '   ' });
    expect((result.details as { committed?: boolean }).committed).toBe(false);
  });
});
