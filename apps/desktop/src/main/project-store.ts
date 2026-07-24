/**
 * @deprecated Prefer `@pi-desktop/database` SqliteProjectRepository / DesktopDatabase.
 * Re-export kept for transitional imports and tests.
 */
export {
  SqliteProjectRepository as ProjectStore,
  projectIdForPath,
} from '@pi-desktop/database';
export type { ProjectRepository } from '@pi-desktop/database';
