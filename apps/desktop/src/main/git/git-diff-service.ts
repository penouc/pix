import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ChangedFile, WorkingTreeDiff } from '@pi-desktop/protocol';

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 1_000_000;

export class GitDiffError extends Error {
  constructor(
    readonly code: 'GIT_DIFF_FAILED' | 'GIT_DIFF_TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}

/** Read-only working-tree diff service. Renderer input never controls Git arguments. */
export async function getWorkingTreeDiff(
  projectId: string,
  projectPath: string,
): Promise<WorkingTreeDiff> {
  try {
    const [patchResult, namesResult, numstatResult] = await Promise.all([
      execGitDiff(projectPath, []),
      execGitDiff(projectPath, ['--name-status', '-z']),
      execGitDiff(projectPath, ['--numstat', '-z']),
    ]);
    const patch = patchResult;
    const files = parseChangedFiles(namesResult, numstatResult);
    if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
      return {
        projectId,
        patch: patch.slice(0, MAX_PATCH_BYTES),
        truncated: true,
        files,
      };
    }
    return { projectId, patch, truncated: false, files };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/maxBuffer length exceeded/i.test(message)) {
      throw new GitDiffError(
        'GIT_DIFF_TOO_LARGE',
        `Working-tree diff exceeds the ${MAX_PATCH_BYTES / 1_000_000} MB review limit.`,
      );
    }
    throw new GitDiffError('GIT_DIFF_FAILED', `Unable to read working-tree diff: ${message}`);
  }
}

async function execGitDiff(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      projectPath,
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--find-renames',
      ...args,
      'HEAD',
    ],
    {
      encoding: 'utf8',
      maxBuffer: MAX_PATCH_BYTES + 1,
      windowsHide: true,
    },
  );
  return String(stdout);
}

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
