import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopDatabase } from '@pi-desktop/database';

import { SessionLogSyncService } from './session-log-sync.js';

describe('SessionLogSyncService', () => {
  let root: string;
  let db: DesktopDatabase;
  let sessionsDir: string;

  afterEach(async () => {
    db?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    root = await mkdtemp(path.join(tmpdir(), 'pi-session-log-sync-'));
    sessionsDir = path.join(root, 'desktop-sessions');
    await mkdir(sessionsDir, { recursive: true });
    db = DesktopDatabase.open(path.join(root, 'pi-desktop.sqlite'));
    const projectPath = path.join(root, 'proj');
    await mkdir(projectPath, { recursive: true });
    const project = await db.projects.open(projectPath);
    await db.sessions.create({
      id: 'sess-1',
      projectId: project.id,
      title: 'Test',
    });
    return { projectId: project.id, projectPath };
  }

  function assistantLine(id: string, usage: Record<string, unknown>, ts: number) {
    return JSON.stringify({
      type: 'message',
      id,
      timestamp: new Date(ts).toISOString(),
      message: {
        role: 'assistant',
        provider: 'opencode-go',
        model: 'deepseek-v4-flash',
        timestamp: ts,
        usage,
      },
    });
  }

  it('imports cacheRead tokens from session JSONL', async () => {
    const { projectPath } = await setup();
    const file = path.join(sessionsDir, '2026-08-08T00-00-00-000Z_sess-1.jsonl');
    await writeFile(
      file,
      [
        JSON.stringify({ type: 'session', id: 'sess-1', cwd: projectPath }),
        assistantLine(
          'msg-1',
          {
            input: 100,
            output: 20,
            cacheRead: 50_000,
            cacheWrite: 0,
            totalTokens: 50_120,
            cost: { total: 0.01 },
          },
          1_700_000_000_000,
        ),
        '',
      ].join('\n'),
    );

    const sync = new SessionLogSyncService(sessionsDir, async () => db);
    const result = await sync.sync();
    expect(result.imported).toBe(1);

    const row = db.db
      .prepare(
        `SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
           FROM run_metrics WHERE run_id = ?`,
      )
      .get('session-log:msg-1') as {
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      cost_usd: number;
    };
    expect(row).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 50_000,
      cache_write_tokens: 0,
      cost_usd: 0.01,
    });
  });

  it('backfills cache onto older session-log rows and clears overlapping live tokens', async () => {
    const { projectId, projectPath } = await setup();
    const startedAt = 1_700_000_000_000;

    // Incomplete import (pre-cache fix) plus a live run that covered the turn.
    db.db
      .prepare(
        `INSERT INTO run_metrics (
           run_id, session_id, project_id, provider_id, model_id,
           started_at, completed_at, tool_call_count, file_change_count,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           cost_usd, outcome
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'completed')`,
      )
      .run(
        'session-log:msg-2',
        'sess-1',
        projectId,
        'opencode-go',
        'deepseek-v4-flash',
        startedAt,
        startedAt,
        100,
        20,
        0,
        0,
        0.001,
      );
    db.db
      .prepare(
        `INSERT INTO run_metrics (
           run_id, session_id, project_id, provider_id, model_id,
           started_at, completed_at, tool_call_count, file_change_count,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           cost_usd, outcome
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 3, 1, ?, ?, ?, ?, ?, 'completed')`,
      )
      .run(
        'live-run-1',
        'sess-1',
        projectId,
        'opencode-go',
        'deepseek-v4-flash',
        startedAt - 1_000,
        startedAt + 60_000,
        100,
        20,
        null,
        null,
        0.001,
      );

    const file = path.join(sessionsDir, '2026-08-08T00-00-00-000Z_sess-1.jsonl');
    await writeFile(
      file,
      [
        JSON.stringify({ type: 'session', id: 'sess-1', cwd: projectPath }),
        assistantLine(
          'msg-2',
          {
            input: 100,
            output: 20,
            cacheRead: 80_000,
            cacheWrite: 0,
            totalTokens: 80_120,
            cost: { total: 0.02 },
          },
          startedAt,
        ),
        '',
      ].join('\n'),
    );

    const sync = new SessionLogSyncService(sessionsDir, async () => db);
    await sync.sync({ force: true });

    const sessionLog = db.db
      .prepare(
        `SELECT cache_read_tokens, cost_usd FROM run_metrics WHERE run_id = ?`,
      )
      .get('session-log:msg-2') as { cache_read_tokens: number; cost_usd: number };
    expect(sessionLog.cache_read_tokens).toBe(80_000);
    expect(sessionLog.cost_usd).toBe(0.02);

    const live = db.db
      .prepare(
        `SELECT input_tokens, output_tokens, cache_read_tokens, cost_usd, tool_call_count
           FROM run_metrics WHERE run_id = ?`,
      )
      .get('live-run-1') as {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_tokens: number | null;
      cost_usd: number | null;
      tool_call_count: number;
    };
    expect(live.input_tokens).toBeNull();
    expect(live.output_tokens).toBeNull();
    expect(live.cache_read_tokens).toBeNull();
    expect(live.cost_usd).toBeNull();
    expect(live.tool_call_count).toBe(3);
  });
});
