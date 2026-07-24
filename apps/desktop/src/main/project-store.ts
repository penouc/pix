import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProjectSummary } from '@pi-desktop/protocol';

function projectIdForPath(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

export class ProjectStore {
  private readonly byId = new Map<string, ProjectSummary>();
  private persistPath: string | null = null;
  private loaded = false;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  /** Load recent projects from disk (best-effort). */
  async init(): Promise<void> {
    if (this.loaded || !this.persistPath) {
      this.loaded = true;
      return;
    }
    try {
      const raw = await fs.readFile(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as { projects?: ProjectSummary[] };
      for (const project of parsed.projects ?? []) {
        if (project?.id && project.path) {
          this.byId.set(project.id, project);
        }
      }
    } catch {
      // missing or corrupt — start empty
    }
    this.loaded = true;
  }

  listRecent(): ProjectSummary[] {
    return [...this.byId.values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 20);
  }

  get(id: string): ProjectSummary | undefined {
    return this.byId.get(id);
  }

  async open(rawPath: string): Promise<ProjectSummary> {
    await this.init();
    const resolved = path.resolve(rawPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }

    const isGit = await fs
      .access(path.join(resolved, '.git'))
      .then(() => true)
      .catch(() => false);

    const id = projectIdForPath(resolved);
    const existing = this.byId.get(id);
    const summary: ProjectSummary = {
      id: existing?.id ?? id,
      path: resolved,
      name: path.basename(resolved) || resolved,
      // M3 will introduce explicit trust UI; for M1 tech-verify we mark Git repos trusted.
      trusted: isGit,
      isGit,
      lastOpenedAt: Date.now(),
    };
    this.byId.set(summary.id, summary);
    await this.persist();
    return summary;
  }

  /** Test helper — seed a project without filesystem access. */
  seed(partial: Partial<ProjectSummary> & { path: string }): ProjectSummary {
    const id = partial.id ?? randomUUID();
    const summary: ProjectSummary = {
      id,
      path: partial.path,
      name: partial.name ?? path.basename(partial.path),
      trusted: partial.trusted ?? false,
      isGit: partial.isGit ?? false,
      lastOpenedAt: partial.lastOpenedAt ?? Date.now(),
    };
    this.byId.set(id, summary);
    return summary;
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      await fs.writeFile(
        this.persistPath,
        JSON.stringify({ projects: this.listRecent() }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('[ProjectStore] persist failed', error);
    }
  }
}
