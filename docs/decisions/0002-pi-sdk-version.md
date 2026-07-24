# ADR 0002: Lock Pi SDK at 0.82.0

## Status

Accepted (2026-07-24)

## Context

M1 requires a real Pi Session in Electron Main. The package formerly published under
`@mariozechner/*` is now `@earendil-works/*` (see total plan §20 and npm).

## Decision

Lock the following exact versions (no caret ranges):

| Package | Version |
|---------|---------|
| `@earendil-works/pi-coding-agent` | `0.82.0` |
| `@earendil-works/pi-agent-core` | `0.82.0` |
| `@earendil-works/pi-ai` | `0.82.0` |

Adapter entry: `packages/agent-pi` → `PiAgentRuntime` via `createAgentSession` + `ModelRuntime` + `SessionManager.inMemory()`.

Factory switch:

- Default: `PiAgentRuntime`
- Offline / UI tests: `PI_DESKTOP_FAKE_RUNTIME=1` or `forceFake: true`

## Consequences

- Upgrades require contract tests + fixed evaluation suite (plan §5).
- Electron main build must externalize `@earendil-works/*` (and native deps) to avoid bundle conflicts.
- Provider auth remains Pi-owned; Desktop will later surface login UX (M3) without re-implementing providers.

## Upgrade checklist

1. Bump three packages in lockstep.
2. Re-run `packages/agent-pi` smoke + event-mapper tests.
3. Re-run Electron dev: create session + one real prompt.
4. Re-validate packaged macOS ARM64 load.
5. Update this ADR version table.
