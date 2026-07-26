import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openDatabase, SqliteIndexRepository, type SqliteDatabase } from '@pi-desktop/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IndexService, type IndexTarget } from './index-service.js';

describe('IndexService', () => {
  let db: SqliteDatabase;
  let repo: SqliteIndexRepository;
  let root: string;
  let projects: IndexTarget[];
  let service: IndexService;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    repo = new SqliteIndexRepository(db);
    root = await mkdtemp(path.join(tmpdir(), 'pi-index-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'alpha.ts'), 'export const distinctiveName = 1;\n');
    await writeFile(path.join(root, 'README.md'), '# hello indexer\n');
    projects = [{ id: 'p1', name: 'demo', path: root, trusted: true, isGit: false }];
    service = new IndexService({ repo, listProjects: () => projects });
  });

  afterEach(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it('indexes paths and bodies of a trusted project', async () => {
    const state = await service.refresh('p1');

    expect(state?.files).toBe(2);
    const results = service.search({ query: 'distinctiveName' });
    expect(results.content.map((hit) => hit.path)).toEqual(['src/alpha.ts']);
    expect(results.content[0]!.projectName).toBe('demo');
    expect(results.content[0]!.projectPath).toBe(root);
  });

  it('never reads an untrusted project', async () => {
    projects[0]!.trusted = false;

    const state = await service.refresh('p1');

    expect(state).toBeNull();
    expect(repo.searchContent({ query: 'distinctiveName' })).toHaveLength(0);
  });

  it('deletes an existing index when trust is revoked', async () => {
    await service.refresh('p1');
    expect(repo.searchContent({ query: 'distinctiveName' })).toHaveLength(1);

    // Trust is what gates reading these files at all; an index that outlived it
    // would keep serving their contents to search.
    projects[0]!.trusted = false;
    await service.refresh('p1');

    expect(repo.searchContent({ query: 'distinctiveName' })).toHaveLength(0);
    expect(service.search({ query: 'distinctiveName' }).content).toHaveLength(0);
  });

  it('excludes untrusted projects from search even if rows survive', async () => {
    await service.refresh('p1');
    projects[0]!.trusted = false;

    // No refresh in between: the rows are still in the table.
    expect(repo.searchPaths({ query: 'alpha' })).toHaveLength(1);
    expect(service.search({ query: 'alpha' }).paths).toHaveLength(0);
  });

  it('re-reads only changed files and drops deleted ones', async () => {
    await service.refresh('p1');

    await rm(path.join(root, 'README.md'));
    await writeFile(path.join(root, 'src', 'beta.ts'), 'const addedLater = 2;\n');
    const state = await service.refresh('p1');

    expect(state?.files).toBe(2);
    expect(service.search({ query: 'hello' }).content).toHaveLength(0);
    expect(service.search({ query: 'addedLater' }).content).toHaveLength(1);
  });

  it('lists a binary file by path but does not index its bytes', async () => {
    await writeFile(path.join(root, 'blob.dat'), Buffer.from([0x41, 0x00, 0x42, 0x43]));

    const state = await service.refresh('p1');

    expect(state?.skipped).toBeGreaterThanOrEqual(1);
    expect(service.search({ query: 'blob' }).paths.map((hit) => hit.path)).toContain('blob.dat');
  });

  it('scopes search to one project when asked', async () => {
    const other = await mkdtemp(path.join(tmpdir(), 'pi-index2-'));
    await writeFile(path.join(other, 'alpha.ts'), 'shared\n');
    projects.push({ id: 'p2', name: 'other', path: other, trusted: true, isGit: false });
    await service.refresh('p1');
    await service.refresh('p2');

    try {
      expect(service.search({ query: 'alpha' }).paths).toHaveLength(2);
      expect(service.search({ query: 'alpha', projectId: 'p2' }).paths).toEqual([
        { projectId: 'p2', path: 'alpha.ts', projectName: 'other', projectPath: other },
      ]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent refreshes of one project', async () => {
    const first = service.refresh('p1');
    const second = service.refresh('p1');

    expect(await first).toBe(await second);
    expect(service.isIndexing('p1')).toBe(false);
  });

  it('skips a refresh that a recent pass already covered', async () => {
    const first = await service.refreshIfStale('p1');
    const second = await service.refreshIfStale('p1');

    expect(second?.updatedAt).toBe(first?.updatedAt);
  });

  it('reports never-indexed and untrusted projects in status', async () => {
    projects.push({ id: 'p2', name: 'locked', path: root, trusted: false, isGit: false });
    await service.refresh('p1');

    const status = service.status();
    expect(status.find((entry) => entry.projectId === 'p1')?.updatedAt).toBeGreaterThan(0);
    const locked = status.find((entry) => entry.projectId === 'p2');
    expect(locked).toMatchObject({ trusted: false, files: 0, updatedAt: null });
  });
});
