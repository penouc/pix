import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalizePath, isPathInsideWorkspace, toWorkspaceRelative } from './path-utils.js';

describe('canonicalizePath', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    // `/var` on macOS is itself a symlink to `/private/var`, which is exactly the
    // shape that used to break the confinement check.
    root = await mkdtemp(path.join(tmpdir(), 'pi-path-'));
    outside = await mkdtemp(path.join(tmpdir(), 'pi-path-out-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), '');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('resolves an existing path through symlinks', () => {
    expect(canonicalizePath(root, 'src/a.ts')).toBe(
      realpathSync.native(path.join(root, 'src', 'a.ts')),
    );
  });

  it('resolves a path that does not exist yet via its deepest existing ancestor', () => {
    // A write target: the file is absent, but the workspace it lands in is real.
    const resolved = canonicalizePath(root, 'src/new-file.ts');

    expect(resolved).toBe(path.join(realpathSync.native(root), 'src', 'new-file.ts'));
    // Regression: with the unresolved path, this read as an escape attempt and a
    // legitimate new file under a symlinked project root was refused.
    expect(isPathInsideWorkspace(root, resolved)).toBe(true);
    // Platform separators: `src/new-file.ts` on POSIX, `src\new-file.ts` on Windows.
    expect(toWorkspaceRelative(root, resolved)).toBe(path.join('src', 'new-file.ts'));
  });

  it('follows a symlinked ancestor of a path that does not exist', async () => {
    await symlink(outside, path.join(root, 'linked'));

    const resolved = canonicalizePath(root, 'linked/new-file.ts');

    expect(resolved).toBe(path.join(realpathSync.native(outside), 'new-file.ts'));
    // The escape is now visible; before, the unresolved path looked contained.
    expect(isPathInsideWorkspace(root, resolved)).toBe(false);
  });

  it('still refuses a path outside the workspace', () => {
    expect(isPathInsideWorkspace(root, canonicalizePath(root, path.join(outside, 'x.ts')))).toBe(
      false,
    );
    expect(isPathInsideWorkspace(root, canonicalizePath(root, '../../etc/passwd'))).toBe(false);
  });

  it('treats the workspace root itself as inside', () => {
    expect(isPathInsideWorkspace(root, canonicalizePath(root, '.'))).toBe(true);
    expect(toWorkspaceRelative(root, canonicalizePath(root, '.'))).toBe('.');
  });
});
