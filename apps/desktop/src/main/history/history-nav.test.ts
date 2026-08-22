import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DesktopDatabase } from '@pi-desktop/database';

import { HistoryService } from './history-service.js';

describe('HistoryService.nav', () => {
  it('includes a folder opened in PiX even with no history sessions', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pix-history-nav-'));
    const db = DesktopDatabase.open(path.join(dir, 'desktop.sqlite'));
    const projectDir = path.join(dir, 'my-app');
    mkdirSync(projectDir);

    const opened = await db.projects.open(projectDir);
    const nav = await new HistoryService(db).nav();

    expect(nav.projects.some((item) => item.pixProjectId === opened.id)).toBe(true);
    expect(nav.projects.some((item) => item.name === 'my-app')).toBe(true);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
