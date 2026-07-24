import type { ProjectSummary } from '@pi-desktop/protocol';

/**
 * Desktop Project repository (plan §10 / M3).
 * Implementations must only run in Electron Main (or Node tests).
 */
export interface ProjectRepository {
  init(): Promise<void>;
  listRecent(limit?: number): ProjectSummary[];
  get(id: string): ProjectSummary | undefined;
  getByPath(projectPath: string): ProjectSummary | undefined;
  /** Open/register a directory as a project (resolves path, detects Git, preserves trust). */
  open(rawPath: string): Promise<ProjectSummary>;
  setTrust(projectId: string, trusted: boolean): Promise<ProjectSummary>;
  put(project: ProjectSummary): Promise<ProjectSummary>;
  close(): void;
}
