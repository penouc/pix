import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Tracked-file search for the ⌘K palette. `git ls-files` is used so results
 * respect .gitignore and never include build output or ignored secrets.
 */
export async function searchProjectFiles(
  workspaceRoot: string,
  query: string,
  limit = 40,
): Promise<string[]> {
  let stdout: string;
  try {
    const result = await exec('git', ['ls-files', '--cached', '--other', '--exclude-standard'], {
      cwd: workspaceRoot,
      maxBuffer: MAX_BUFFER,
    });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const needle = query.trim().toLowerCase();
  const paths = stdout.split('\n').filter(Boolean);
  if (!needle) return paths.slice(0, limit);

  // Rank exact substring hits on the basename above hits anywhere in the path.
  const scored: Array<{ path: string; score: number }> = [];
  for (const filePath of paths) {
    const lower = filePath.toLowerCase();
    const index = lower.indexOf(needle);
    if (index === -1) continue;
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const inBase = base.includes(needle);
    scored.push({ path: filePath, score: (inBase ? 0 : 500) + index + filePath.length / 1000 });
    if (scored.length > limit * 20) break;
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.path);
}

/**
 * Current branch name, or null outside a repo / on a detached HEAD. Used by the
 * composer's context pill, which previously showed a hardcoded `main`.
 */
export async function readCurrentBranch(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot,
      maxBuffer: 64 * 1024,
    });
    const branch = stdout.trim();
    if (!branch || branch === 'HEAD') return null;
    return branch;
  } catch {
    return null;
  }
}
