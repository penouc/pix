import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';
import { SqliteIndexRepository, toMatchQuery } from './sqlite-index-repository.js';

describe('SqliteIndexRepository', () => {
  let db: SqliteDatabase;
  let repo: SqliteIndexRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteIndexRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function put(projectId: string, filePath: string, body?: string) {
    repo.upsertFile({
      projectId,
      path: filePath,
      size: body?.length ?? 0,
      mtimeMs: 1,
      ...(body == null ? {} : { body }),
    });
  }

  it('ranks basename matches above mid-path matches', () => {
    put('p1', 'src/deep/nested/other.ts');
    put('p1', 'src/button.ts');

    const hits = repo.searchPaths({ query: 'button' });
    expect(hits.map((hit) => hit.path)).toEqual(['src/button.ts']);
  });

  it('searches every project by default and only the named ones when scoped', () => {
    put('p1', 'a/widget.ts');
    put('p2', 'b/widget.ts');

    expect(repo.searchPaths({ query: 'widget' })).toHaveLength(2);
    expect(repo.searchPaths({ query: 'widget', projectIds: ['p2'] })).toEqual([
      { projectId: 'p2', path: 'b/widget.ts' },
    ]);
  });

  it('finds words in file bodies', () => {
    put('p1', 'src/policy.ts', 'export const approvalMode = "read-only";');

    const hits = repo.searchContent({ query: 'approvalMode' });
    expect(hits.map((hit) => hit.path)).toEqual(['src/policy.ts']);
    expect(hits[0]!.excerpt).toContain('approvalMode');
  });

  it('replaces the body on re-index rather than accumulating rows', () => {
    put('p1', 'src/a.ts', 'alpha marker');
    put('p1', 'src/a.ts', 'beta marker');

    // One row, and the old text is gone — otherwise an edited file would return
    // twice and stale content would stay searchable forever.
    expect(repo.searchContent({ query: 'marker' })).toHaveLength(1);
    expect(repo.searchContent({ query: 'alpha' })).toHaveLength(0);
    expect(repo.searchContent({ query: 'beta' })).toHaveLength(1);
  });

  it('drops paths, bodies, and state when a project is forgotten', () => {
    put('p1', 'src/a.ts', 'secret token');
    repo.putState({
      projectId: 'p1',
      head: 'abc',
      files: 1,
      indexedBytes: 12,
      skipped: 0,
      updatedAt: Date.now(),
      durationMs: 5,
    });

    repo.deleteProject('p1');

    expect(repo.searchPaths({ query: 'a.ts' })).toHaveLength(0);
    expect(repo.searchContent({ query: 'secret' })).toHaveLength(0);
    expect(repo.getState('p1')).toBeUndefined();
  });

  it('deleting one file leaves its body unsearchable', () => {
    put('p1', 'src/a.ts', 'unique-needle');
    put('p1', 'src/b.ts', 'unique-needle');

    repo.deleteFile('p1', 'src/a.ts');

    expect(repo.searchContent({ query: 'unique-needle' }).map((hit) => hit.path)).toEqual([
      'src/b.ts',
    ]);
  });

  it('treats FTS operator characters in the query as literal text', () => {
    put('p1', 'src/a.ts', 'a TODO: fix the read-only path');

    // Each of these is a syntax error as a raw MATCH expression.
    expect(repo.searchContent({ query: 'read-only' })).toHaveLength(1);
    expect(repo.searchContent({ query: 'TODO:' })).toHaveLength(1);
    expect(repo.searchContent({ query: '"unbalanced' })).toHaveLength(0);
    expect(repo.searchContent({ query: 'NOT OR AND' })).toHaveLength(0);
  });

  it('does not let LIKE wildcards in a path query match anything', () => {
    put('p1', 'src/ab.ts');

    // `_` is a single-character LIKE wildcard; unescaped this would match `ab`.
    expect(repo.searchPaths({ query: 'a_' })).toHaveLength(0);
    expect(repo.searchPaths({ query: 'ab' })).toHaveLength(1);
  });

  it('round-trips index state', () => {
    const state = {
      projectId: 'p1',
      head: 'deadbeef',
      files: 42,
      indexedBytes: 4096,
      skipped: 3,
      updatedAt: 1_700_000_000_000,
      durationMs: 120,
    };
    repo.putState(state);
    expect(repo.getState('p1')).toEqual(state);
    expect(repo.listStates()).toEqual([state]);
  });
});

describe('toMatchQuery', () => {
  it('quotes each token and prefix-matches the last', () => {
    expect(toMatchQuery('foo bar')).toBe('"foo" "bar"*');
  });

  it('splits on punctuation so operators cannot survive', () => {
    expect(toMatchQuery('read-only()')).toBe('"read" "only"*');
  });

  it('returns null when there is nothing to search for', () => {
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('***')).toBeNull();
  });
});
