# Data Model

Desktop-owned entities (plan §10). Pi owns its own session transcript / compaction.

## Ownership

| Entity | Owner | Storage |
|--------|-------|---------|
| Pi Session messages | Pi | Pi SessionManager / agentDir |
| Project | Desktop | **SQLite** `projects` table |
| Session metadata | Desktop | **SQLite** `sessions` table |
| AgentRun / Approval / Checkpoint | Desktop | Planned SQLite tables |

## SQLite

- Package: `@pi-desktop/database`
- Entry: `DesktopDatabase` (single connection, shared by project + session repos)
- Driver: Node built-in `node:sqlite` (`DatabaseSync`) — Main/Node only
- Default path: `{userData}/pi-desktop.sqlite`
- Migrations: `schema_migrations` + versioned SQL in `packages/database/src/migrations.ts`
- WAL mode enabled

### projects (migration v2)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | sha256(path)[:16] |
| path | TEXT UNIQUE | absolute resolved path |
| name | TEXT | basename |
| trusted | INTEGER 0/1 | Workspace Trust |
| is_git | INTEGER 0/1 | `.git` present |
| last_opened_at | INTEGER | ms epoch |

### sessions (migration v1)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID from AgentRuntime session |
| project_id | TEXT | Desktop project id |
| title | TEXT | UI name |
| created_at | INTEGER | ms epoch |
| updated_at | INTEGER | ms epoch |
| archived | INTEGER 0/1 | soft delete |

## Legacy migration

On first open, import once (skip existing ids):

- `{userData}/sessions.json` → `sessions`
- `{userData}/recent-projects.json` → `projects`

## Repository boundary

Callers depend on `SessionRepository` / `ProjectRepository` (or `DesktopDatabase`), not on SQLite types.
