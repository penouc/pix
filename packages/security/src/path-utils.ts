import fs from 'node:fs';
import path from 'node:path';

/**
 * Realpath as much of `absolute` as exists, keeping the rest verbatim.
 *
 * Every function here resolves through this one, and that is the point: the
 * confinement check compares a target against a root, so if the two sides
 * resolve symlinks differently the comparison is meaningless. `canonicalizePath`
 * used to return unresolved paths for files that do not exist yet while the root
 * was always resolved — so on macOS, where `/tmp` and `/var` are symlinks, a
 * legitimate new file inside the project read as an escape attempt, and a
 * symlinked ancestor of a missing path was never followed at all.
 */
function resolveExisting(absolute: string): string {
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    // Does not exist (yet) — walk up to something that does.
  }

  const trailing: string[] = [];
  let cursor = path.normalize(absolute);
  for (;;) {
    const parent = path.dirname(cursor);
    // Reached the filesystem root without finding anything that exists.
    if (parent === cursor) return path.normalize(absolute);
    trailing.unshift(path.basename(cursor));
    cursor = parent;
    try {
      return path.join(fs.realpathSync.native(cursor), ...trailing);
    } catch {
      // Keep walking up.
    }
  }
}

/**
 * Resolve a user/tool-supplied path against the workspace root.
 * Does not throw on missing files — a write target does not exist yet.
 */
export function canonicalizePath(workspaceRoot: string, inputPath: string): string {
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);
  return resolveExisting(absolute);
}

export function isPathInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  const rel = workspaceRelative(workspaceRoot, absolutePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string | null {
  if (!isPathInsideWorkspace(workspaceRoot, absolutePath)) return null;
  const rel = workspaceRelative(workspaceRoot, absolutePath);
  return rel === '' ? '.' : rel;
}

/** Both sides resolved the same way before comparing. */
function workspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const root = resolveExisting(path.resolve(workspaceRoot));
  return path.relative(root, resolveExisting(path.normalize(absolutePath)));
}
