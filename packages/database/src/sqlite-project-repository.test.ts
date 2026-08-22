import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopDatabase } from './desktop-database.js';

describe('SqliteProjectRepository + DesktopDatabase', () => {
  let dir: string;
  let desktop: DesktopDatabase;

  afterEach(async () => {
    desktop?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    dir = await mkdtemp(path.join(tmpdir(), 'pi-proj-db-'));
    desktop = DesktopDatabase.open(path.join(dir, 'desktop.sqlite'));
    return desktop;
  }

  it('opens a directory, preserves trust, and lists recent', async () => {
    const db = await setup();
    const projectDir = path.join(dir, 'my-app');
    await mkdir(projectDir);
    await mkdir(path.join(projectDir, '.git'));

    const opened = await db.projects.open(projectDir);
    expect(opened.isGit).toBe(true);
    expect(opened.trusted).toBe(true);
    expect(db.projects.listRecent()).toHaveLength(1);

    await db.projects.setTrust(opened.id, false);
    expect(db.projects.get(opened.id)?.trusted).toBe(false);

    // Re-open preserves explicit untrust
    const again = await db.projects.open(projectDir);
    expect(again.trusted).toBe(false);
    expect(again.id).toBe(opened.id);
  });

  it('lists projects by most recently opened', async () => {
    const db = await setup();
    await mkdir(path.join(dir, 'z-app'));
    await mkdir(path.join(dir, 'a-app'));
    await db.projects.open(path.join(dir, 'z-app'));
    await db.projects.open(path.join(dir, 'a-app'));
    expect(db.projects.listRecent().map((p) => p.name)).toEqual(['a-app', 'z-app']);
    // Re-opening bumps the folder to the front of the list.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await db.projects.open(path.join(dir, 'z-app'));
    expect(db.projects.listRecent().map((p) => p.name)).toEqual(['z-app', 'a-app']);
  });

  it('shares one DB with sessions and migrates legacy JSON', async () => {
    const db = await setup();
    const projectDir = path.join(dir, 'repo');
    await mkdir(projectDir);

    const project = await db.projects.open(projectDir);
    const session = await db.sessions.create({
      projectId: project.id,
      title: 'S1',
    });
    expect(db.sessions.listByProject(project.id)[0]?.id).toBe(session.id);

    // Legacy import into a fresh file
    const legacyDir = path.join(dir, 'legacy');
    await mkdir(legacyDir);
    await writeFile(
      path.join(legacyDir, 'recent-projects.json'),
      JSON.stringify({
        projects: [
          {
            id: 'legacy-p',
            path: path.join(dir, 'other'),
            name: 'other',
            trusted: true,
            isGit: false,
            lastOpenedAt: 99,
          },
        ],
      }),
      'utf8',
    );
    await mkdir(path.join(dir, 'other'));
    await writeFile(
      path.join(legacyDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            id: 'legacy-s',
            projectId: 'legacy-p',
            title: 'Legacy',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
          },
        ],
      }),
      'utf8',
    );

    const migrated = await db.migrateLegacyJson(legacyDir);
    expect(migrated.projects).toBe(1);
    expect(migrated.sessions).toBe(1);
    expect(db.projects.get('legacy-p')?.name).toBe('other');
    expect(db.sessions.get('legacy-s')?.title).toBe('Legacy');
  });
});
