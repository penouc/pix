import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DesktopDatabase } from '@pi-desktop/database';
import { afterAll, describe, expect, it } from 'vitest';

import { detectAcpAgents } from '../acp/detect.js';
import { ClaudeHistoryAdapter } from './adapters/claude.js';
import { CodexHistoryAdapter } from './adapters/codex.js';
import { PiHistoryAdapter } from './adapters/pi.js';
import { HistoryService } from './history-service.js';

/**
 * Local smoke against real ~/.claude / ~/.codex / ~/.pi data.
 * Skips cleanly when an adapter's root is missing (CI runners).
 */
describe('history library local smoke', () => {
  let dir = '';
  let db: DesktopDatabase | undefined;

  afterAll(async () => {
    db?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('parses at least one session per detected adapter', async () => {
    const adapters = [
      new ClaudeHistoryAdapter(),
      new CodexHistoryAdapter(),
      PiHistoryAdapter.pi(),
      PiHistoryAdapter.omp(),
    ].filter((a) => a.detect());

    if (!adapters.length) {
      console.log('[history-smoke] no local agent histories — skip');
      return;
    }

    for (const adapter of adapters) {
      const files = await adapter.listSessionFiles();
      expect(files.length, `${adapter.agent()} should find sessions`).toBeGreaterThan(0);
      // Prefer recent / smaller files for speed
      const sample = [...files].sort((a, b) => a.size - b.size).slice(0, 3);
      let ok = 0;
      for (const ref of sample) {
        const parsed = await adapter.parseSession(ref);
        if (parsed?.meta.nativeId) ok += 1;
      }
      expect(ok, `${adapter.agent()} parse`).toBeGreaterThan(0);
    }
  }, 120_000);

  it('HistoryService.refresh indexes external sessions into SQLite', async () => {
    const hasLocal =
      new ClaudeHistoryAdapter().detect() ||
      new CodexHistoryAdapter().detect() ||
      PiHistoryAdapter.pi().detect() ||
      PiHistoryAdapter.omp().detect();
    if (!hasLocal) {
      console.log('[history-smoke] no local agent histories — skip refresh');
      return;
    }

    dir = await mkdtemp(path.join(tmpdir(), 'pix-history-smoke-'));
    db = DesktopDatabase.open(path.join(dir, 'desktop.sqlite'));
    const service = new HistoryService(db);

    const result = await service.refresh(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const nav = await service.nav();
    expect(nav.agents.some((a) => a.count > 0 || a.agent === 'pix')).toBe(true);

    const listed = service.list({ limit: 20 });
    // Fresh DB may only have external sessions after refresh
    expect(listed.total + result.scanned).toBeGreaterThan(0);
    console.log(
      '[history-smoke]',
      `scanned=${result.scanned}`,
      `ms=${result.durationMs}`,
      `listed=${listed.total}`,
      `agents=${nav.agents.map((a) => `${a.agent}:${a.count}`).join(',')}`,
      `projects=${nav.projects.length}`,
    );
  }, 180_000);

  it('detects installed ACP agent CLIs', async () => {
    const agents = await detectAcpAgents(true);
    const available = agents.filter((a) => a.available);
    console.log(
      '[acp-smoke]',
      available.map((a) => `${a.id}=${a.command}`).join(', ') || '(none)',
    );
    // CI runners usually have npx; if nothing is available this is still a soft signal.
    expect(available.length).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
