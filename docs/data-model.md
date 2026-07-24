# Data Model

Desktop-owned entities (plan §10). Pi owns its own session transcript / compaction.

## Ownership

| Entity | Owner | Storage |
|--------|-------|---------|
| Pi Session messages | Pi | Pi SessionManager / agentDir |
| Project | Desktop | JSON recent-projects (SQLite later) |
| Session metadata | Desktop | **SQLite** `sessions` table |
| AgentRun / Approval / Checkpoint | Desktop | Planned SQLite tables |

## SQLite

- Package: `@pi-desktop/database`
- Driver: Node built-in `node:sqlite` (`DatabaseSync`) — Main/Node only
- Default path: `{userData}/pi-desktop.sqlite`
- Migrations: `schema_migrations` + versioned SQL in `packages/database/src/migrations.ts`
- WAL mode enabled

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID from AgentRuntime session |
| project_id | TEXT | Desktop project id |
| title | TEXT | UI name |
| created_at | INTEGER | ms epoch |
| updated_at | INTEGER | ms epoch |
| archived | INTEGER 0/1 | soft delete |

## Legacy migration

On first open, if `{userData}/sessions.json` exists, rows are imported once (skip existing ids).

## Repository boundary

Callers depend on `SessionRepository` interface, not on SQLite types — ready for driver swap if needed.
