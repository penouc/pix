import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type SqliteDatabase } from './sqlite-connection.js';
import { SqliteRunMetricsRepository } from './sqlite-run-metrics-repository.js';

const NOW = 1_800_000_000_000;

describe('SqliteRunMetricsRepository', () => {
  let dir: string;
  let db: SqliteDatabase;
  let repo: SqliteRunMetricsRepository;

  afterEach(async () => {
    db.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function createRepo() {
    dir = await mkdtemp(path.join(tmpdir(), 'pi-metrics-'));
    db = openDatabase(path.join(dir, 'metrics.sqlite'));
    repo = new SqliteRunMetricsRepository(db);
    return repo;
  }

  function record(runId: string, projectId: string, startedAt: number, costUsd = 0.001) {
    return repo.record({
      runId,
      sessionId: `session-${runId}`,
      projectId,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      startedAt,
      completedAt: startedAt + 30_000,
      toolCallCount: 2,
      fileChangeCount: 1,
      inputTokens: 500,
      outputTokens: 120,
      cacheReadTokens: 2000,
      cacheWriteTokens: 50,
      costUsd,
      outcome: 'completed',
    });
  }

  it('summarizes totals, days, and models within the window', async () => {
    await createRepo();
    await record('r1', 'p1', NOW - 24 * 60 * 60 * 1000);
    await record('r2', 'p1', NOW);

    const summary = repo.summary({ from: NOW - 3 * 24 * 60 * 60 * 1000, to: NOW });
    expect(summary.totals).toMatchObject({
      runs: 2,
      inputTokens: 1000,
      outputTokens: 240,
      cacheReadTokens: 4000,
      cacheWriteTokens: 100,
    });
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0]).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      runs: 2,
      cacheReadTokens: 4000,
    });
    expect(summary.days.length).toBeGreaterThanOrEqual(2);
  });

  it('scopes the summary to one project', async () => {
    await createRepo();
    await record('r1', 'p1', NOW - 1000);
    await record('r2', 'p2', NOW - 2000);

    const scoped = repo.summary({ from: NOW - 60_000, to: NOW, projectId: 'p2' });
    expect(scoped.totals.runs).toBe(1);
    expect(scoped.byModel[0]?.runs).toBe(1);
  });

  it('lists projects with activity, most recent first', async () => {
    await createRepo();
    await record('r1', 'p1', NOW - 60_000);
    await record('r2', 'p2', NOW - 30_000);
    // A third project outside the window must not appear.
    await record('r3', 'p3', NOW - 10 * 24 * 60 * 60 * 1000);

    const projects = repo.projects({ from: NOW - 24 * 60 * 60 * 1000, to: NOW });
    expect(projects.map((p) => p.projectId)).toEqual(['p2', 'p1']);
    expect(projects[0]).toMatchObject({ runs: 1, lastUsedAt: NOW - 30_000 });
  });
});
