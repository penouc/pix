/**
 * @deprecated Prefer `@pi-desktop/database` SqliteSessionRepository.
 * Kept as a thin re-export so existing import paths keep working during migration.
 */
export { SqliteSessionRepository as SessionStore } from '@pi-desktop/database';
export type { SessionRepository } from '@pi-desktop/database';
