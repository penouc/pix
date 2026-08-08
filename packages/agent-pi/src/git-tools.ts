import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

/*
 * #16 — structured Git tools (self-built).
 *
 * The agent used to reach for `bash git …` for everything. These three
 * read-only tools give it the same data the Diff panel renders — same
 * `git diff --numstat/--name-status` parsing as the desktop's
 * git-diff-service — without a shell:
 *
 *   - git_status — porcelain status, branch, staged/unstaged/untracked split
 *   - git_diff   — patch + changed-file list (working tree or staged)
 *   - git_log    — recent commit subjects
 *
 * All three are classified `safe` (read-only git, no side effects) by the
 * permission pipeline, so they never enter the approval queue.
 *
 * #17 — smart commit splitting builds on these: the agent inspects the diff,
 * proposes a split, asks the user (via the `ask` tool), then stages + commits
 * with `git_commit` — which IS approval-gated (workspace-write) and never
 * pushes (the tool refuses `--push` entirely; there is no push tool at all).
 */

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 1_000_000;

async function execGit(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', projectPath, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_PATCH_BYTES + 1,
    windowsHide: true,
  });
  return String(stdout);
}

export interface GitStatusEntry {
  path: string;
  previousPath?: string;
  /** Porcelain XY code, e.g. 'M', '??', 'R '. */
  xy: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitStatusResult {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}

/** Parse `git status --porcelain=v1 --branch -z` output. Exported for tests. */
export function parseGitStatus(raw: string): GitStatusResult {
  const tokens = raw.split('\0');
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const entries: GitStatusEntry[] = [];
  const head = tokens[0] ?? '';
  if (head.startsWith('## ')) {
    const rest = head.slice(3);
    const branchPart = rest.split('...')[0] ?? rest;
    branch = branchPart.replace(/^HEAD \(no branch\)/, 'HEAD').trim() || null;
    const aheadMatch = /ahead (\d+)/.exec(rest);
    const behindMatch = /behind (\d+)/.exec(rest);
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    behind = behindMatch ? Number(behindMatch[1]) : 0;
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    const entry: GitStatusEntry = {
      path,
      xy,
      staged: xy[0] !== ' ' && xy[0] !== '?',
      untracked: xy === '??',
    };
    // Rename/copy lines are `R  old\0new` — the next token is the target.
    if ((xy[0] === 'R' || xy[0] === 'C') && index + 1 < tokens.length) {
      const target = tokens[index + 1];
      if (target) {
        entry.previousPath = path;
        entry.path = target;
        index += 1;
      }
    }
    entries.push(entry);
  }
  return {
    branch,
    ahead,
    behind,
    entries,
    stagedCount: entries.filter((entry) => entry.staged).length,
    unstagedCount: entries.filter((entry) => !entry.staged && !entry.untracked).length,
    untrackedCount: entries.filter((entry) => entry.untracked).length,
  };
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
}

export interface GitDiffResult {
  patch: string;
  truncated: boolean;
  files: ChangedFile[];
}

/** Parse `--name-status -z` + `--numstat -z` into the Diff panel's shape. */
function parseChangedFiles(names: string, numstat: string): ChangedFile[] {
  const binaryPaths = new Set(
    numstat
      .split('\0')
      .filter(Boolean)
      .filter((entry) => entry.startsWith('-\t-\t'))
      .map((entry) => entry.slice(4)),
  );
  const tokens = names.split('\0');
  const files: ChangedFile[] = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    if (!statusToken) continue;
    const status = statusToken[0];
    if (status === 'R' || status === 'C') {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (!previousPath || !path) continue;
      files.push({
        path,
        previousPath,
        status: 'renamed',
        binary: binaryPaths.has(path) || binaryPaths.has(previousPath),
      });
      continue;
    }
    const path = tokens[index++];
    if (!path) continue;
    files.push({
      path,
      status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified',
      binary: binaryPaths.has(path),
    });
  }
  return files;
}

/** Working-tree (or staged) diff, mirroring the desktop's Diff panel. */
export async function getGitDiff(
  projectPath: string,
  opts: { staged?: boolean } = {},
): Promise<GitDiffResult> {
  const base = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];
  if (opts.staged) base.push('--staged');
  const [patchResult, namesResult, numstatResult] = await Promise.all([
    execGit(projectPath, [...base, 'HEAD']),
    execGit(projectPath, [...base, '--name-status', '-z', 'HEAD']),
    execGit(projectPath, [...base, '--numstat', '-z', 'HEAD']),
  ]);
  const files = parseChangedFiles(namesResult, numstatResult);
  const truncated = Buffer.byteLength(patchResult, 'utf8') > MAX_PATCH_BYTES;
  return {
    patch: truncated ? patchResult.slice(0, MAX_PATCH_BYTES) : patchResult,
    truncated,
    files,
  };
}

function formatStatus(result: GitStatusResult): string {
  const lines = [
    `Branch: ${result.branch ?? '(detached)'}`,
    ...(result.ahead || result.behind
      ? [`Remote: ${result.ahead} ahead, ${result.behind} behind`]
      : []),
  ];
  if (result.entries.length === 0) {
    lines.push('Working tree clean.');
    return lines.join('\n');
  }
  lines.push(
    `${result.stagedCount} staged, ${result.unstagedCount} modified, ${result.untrackedCount} untracked`,
  );
  for (const entry of result.entries) {
    const marker = entry.untracked ? '??' : entry.staged ? 'staged' : 'modified';
    lines.push(
      `  ${marker.padEnd(9)} ${entry.path}${entry.previousPath ? ` (from ${entry.previousPath})` : ''}`,
    );
  }
  return lines.join('\n');
}

const statusSchema = Type.Object({
  /** Optional pathspec filter. */
  paths: Type.Optional(
    Type.Array(Type.String({ description: 'Pathspecs to limit the status to' })),
  ),
});
type StatusParams = Static<typeof statusSchema>;

const diffSchema = Type.Object({
  /** Show only staged changes (git diff --staged). */
  staged: Type.Optional(
    Type.Boolean({ description: 'Show staged changes instead of the working tree' }),
  ),
  /** Optional pathspec filter. */
  paths: Type.Optional(Type.Array(Type.String({ description: 'Pathspecs to limit the diff to' }))),
});
type DiffParams = Static<typeof diffSchema>;

const logSchema = Type.Object({
  /** Number of commits to show. Default 10. */
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
type LogParams = Static<typeof logSchema>;

const commitSchema = Type.Object({
  message: Type.String({ description: 'Commit message (subject, optionally followed by a body)' }),
  /** Files to stage + commit. Defaults to everything in the working tree. */
  files: Type.Optional(
    Type.Array(Type.String({ description: 'Paths to include; default = all changes' })),
  ),
});
type CommitParams = Static<typeof commitSchema>;

function resolveRepo(root: string, _cwd?: string): string {
  // The tool's cwd is the project root (ExtensionContext.cwd). Pathspecs are
  // interpreted relative to it.
  return root;
}

export function createGitStatusTool() {
  return defineTool({
    name: 'git_status',
    label: 'Git status',
    description:
      'Show the working-tree status: current branch, ahead/behind counts, and every changed file split into staged / modified / untracked. Read-only. Use before proposing a commit or to see what changed.',
    promptSnippet: 'git_status — working-tree status (read-only)',
    promptGuidelines: [
      'Use git_status before proposing commits: it shows exactly what is staged vs modified vs untracked.',
      'Pass paths to narrow the view to one area of the repo.',
    ],
    parameters: statusSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: StatusParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<GitStatusResult>> {
      const root = resolveRepo(ctx?.cwd ?? process.cwd());
      const args = ['status', '--porcelain=v1', '--branch', '-z'];
      if (params.paths?.length) args.push('--', ...params.paths);
      const raw = await execGit(root, args);
      const result = parseGitStatus(raw);
      return {
        content: [{ type: 'text', text: formatStatus(result) }],
        details: result,
      };
    },
  });
}

export function createGitDiffTool() {
  return defineTool({
    name: 'git_diff',
    label: 'Git diff',
    description:
      'Show the working-tree diff as a patch plus a structured file list (added/modified/deleted/renamed, binary flags) — the same data the Diff panel renders. Read-only. Optionally show staged changes only.',
    promptSnippet: 'git_diff — working-tree diff (read-only)',
    promptGuidelines: [
      'Use git_diff to see exactly what a proposed commit would contain.',
      'Pass paths to limit the diff to the files you care about.',
    ],
    parameters: diffSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: DiffParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<GitDiffResult>> {
      const root = resolveRepo(ctx?.cwd ?? process.cwd());
      const result = await getGitDiff(root, { staged: params.staged });
      const lines = result.files.length
        ? [
            ...result.files.map(
              (file) =>
                `  ${file.status.padEnd(9)} ${file.path}${file.previousPath ? ` (from ${file.previousPath})` : ''}${file.binary ? ' [binary]' : ''}`,
            ),
            '',
            ...(result.truncated ? ['(patch truncated)'] : []),
            result.patch,
          ]
        : ['No changes.'];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: result,
      };
    },
  });
}

export function createGitLogTool() {
  return defineTool({
    name: 'git_log',
    label: 'Git log',
    description:
      'Show recent commit subjects (with short hashes). Read-only. Use to understand history, find the previous commit, or craft a conventional message.',
    promptSnippet: 'git_log — recent commits (read-only)',
    promptGuidelines: [
      'Use git_log to see the project’s commit style before writing your own message.',
    ],
    parameters: logSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: LogParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ commits: string[] }>> {
      const root = resolveRepo(ctx?.cwd ?? process.cwd());
      const limit = Math.min(100, Math.max(1, params.limit ?? 10));
      const raw = await execGit(root, ['log', `--max-count=${limit}`, '--oneline', '--decorate']);
      const commits = raw.split('\n').filter(Boolean);
      return {
        content: [{ type: 'text', text: commits.length ? commits.join('\n') : '(no commits yet)' }],
        details: { commits },
      };
    },
  });
}

/**
 * #17 — the only mutating Git tool. Stages the given files (or everything)
 * and commits them locally. Approval-gated (`workspace-write` in the risk
 * classifier) and deliberately incapable of pushing: there is no push
 * parameter, and no push tool exists in the session.
 */
export function createGitCommitTool() {
  return defineTool({
    name: 'git_commit',
    label: 'Git commit (local only)',
    description:
      'Stage and commit changes locally. This WRITES to the repo (git index + objects) — it requires approval in Ask mode and is blocked in Plan Mode. It can never push; pushing stays a manual user action.',
    promptSnippet: 'git_commit — stage + local commit (approval-gated)',
    promptGuidelines: [
      'Before committing, run git_diff to see exactly what will be included.',
      'When the change naturally splits into several commits, propose the split with ask first, then commit piece by piece (files = one group per commit).',
      'Message should follow the repo’s style from git_log (e.g. conventional commits).',
      'Never commit without being sure the user wants it — a multi-commit proposal always gets confirmed first.',
    ],
    parameters: commitSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: CommitParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ committed: boolean; hash?: string; summary?: string }>> {
      const root = resolveRepo(ctx?.cwd ?? process.cwd());
      const message = params.message.trim();
      if (!message) {
        return {
          content: [{ type: 'text', text: 'Commit message must not be empty.' }],
          details: { committed: false },
        };
      }
      const files = params.files?.filter((f) => f.trim());
      if (files?.length) {
        await execGit(root, ['add', '--', ...files]);
      } else {
        await execGit(root, ['add', '-A']);
      }
      const summary = (await execGit(root, ['commit', '-m', message])).trim();
      const hashMatch = /^\[[^\]]+ ([0-9a-f]{7,})/.exec(summary);
      const hash = hashMatch?.[1];
      return {
        content: [{ type: 'text', text: summary || 'Committed.' }],
        details: { committed: true, ...(hash ? { hash } : {}), summary },
      };
    },
  });
}
