import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { CheckpointBaselineInput } from '@pi-desktop/database';

const execFileAsync = promisify(execFile);

export type CapturedCheckpointBaseline = Omit<
  CheckpointBaselineInput,
  'id' | 'projectId' | 'sessionId'
>;

/**
 * Read task-before Git state. This service is Main-only: it accepts no renderer
 * input and reads only paths that are inside the known workspace.
 */
export async function captureCheckpointBaseline(
  workspacePath: string,
): Promise<CapturedCheckpointBaseline> {
  const workspace = await realpath(workspacePath);
  const status = await getGitStatus(workspace);
  if (!status) {
    return {
      workspacePath: workspace,
      isGit: false,
      statusPorcelain: Buffer.alloc(0),
      files: [],
    };
  }

  const files = await Promise.all(
    parsePorcelain(status.porcelain).map(async (entry) => ({
      path: entry.path,
      originalPath: entry.originalPath,
      status: entry.status,
      ...(await hashWorkspaceFile(workspace, entry.path)),
    })),
  );
  return {
    workspacePath: workspace,
    isGit: true,
    headOid: await readGitOid(workspace, ['rev-parse', '--verify', 'HEAD']),
    indexTreeOid: await readGitOid(workspace, ['write-tree']),
    statusPorcelain: status.porcelain,
    files,
  };
}

export function checkpointId(): string {
  return randomUUID();
}

async function getGitStatus(workspace: string): Promise<{ porcelain: Buffer } | undefined> {
  try {
    const inside = await execGit(workspace, ['rev-parse', '--is-inside-work-tree'], 'utf8');
    if (String(inside).trim() !== 'true') return undefined;
    return {
      porcelain: Buffer.from(
        await execGit(
          workspace,
          ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
          'buffer',
        ),
      ),
    };
  } catch {
    return undefined;
  }
}

async function readGitOid(workspace: string, args: string[]): Promise<string | undefined> {
  try {
    return String(await execGit(workspace, args, 'utf8')).trim() || undefined;
  } catch {
    // An unborn repository has no HEAD; the index tree is still independently useful.
    return undefined;
  }
}

async function execGit(
  workspace: string,
  args: string[],
  encoding: 'utf8' | 'buffer',
): Promise<string | Buffer> {
  const { stdout } = await execFileAsync('git', ['-C', workspace, ...args], {
    encoding,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout as string | Buffer;
}

interface PorcelainEntry {
  status: string;
  path: string;
  originalPath?: string;
}

function parsePorcelain(porcelain: Buffer): PorcelainEntry[] {
  const tokens = porcelain.toString('utf8').split('\0');
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++];
    if (!token) continue;
    const status = token.slice(0, 2);
    const filePath = token.slice(3);
    if (!filePath) continue;
    const renamedOrCopied = status.includes('R') || status.includes('C');
    const originalPath = renamedOrCopied ? tokens[index++] || undefined : undefined;
    entries.push({ status, path: filePath, originalPath });
  }
  return entries;
}

async function hashWorkspaceFile(
  workspace: string,
  relativePath: string,
): Promise<{ exists: boolean; sha256?: string }> {
  if (!isSafeRelativePath(relativePath)) return { exists: false };
  const candidate = path.resolve(workspace, relativePath);
  if (candidate !== workspace && !candidate.startsWith(`${workspace}${path.sep}`)) {
    return { exists: false };
  }
  try {
    const stat = await lstat(candidate);
    if (!stat.isFile()) return { exists: true };
    const bytes = await readFile(candidate);
    return {
      exists: true,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

function isSafeRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !path.isAbsolute(filePath) &&
    !filePath
      .split(/[\\/]/)
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
