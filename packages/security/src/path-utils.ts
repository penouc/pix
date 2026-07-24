import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve and optionally realpath a user/tool-supplied path against workspace root.
 * Does not throw on missing files — falls back to resolved absolute path.
 */
export function canonicalizePath(workspaceRoot: string, inputPath: string): string {
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    // File may not exist yet (write/create). Use normalized absolute path.
    return path.normalize(absolute);
  }
}

export function isPathInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  const root = path.resolve(workspaceRoot);
  let rootReal = root;
  try {
    rootReal = fs.realpathSync.native(root);
  } catch {
    // ignore
  }
  const target = path.normalize(absolutePath);
  const rel = path.relative(rootReal, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string | null {
  if (!isPathInsideWorkspace(workspaceRoot, absolutePath)) return null;
  const root = path.resolve(workspaceRoot);
  let rootReal = root;
  try {
    rootReal = fs.realpathSync.native(root);
  } catch {
    // ignore
  }
  const rel = path.relative(rootReal, path.normalize(absolutePath));
  return rel === '' ? '.' : rel;
}
