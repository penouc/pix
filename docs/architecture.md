# Architecture

> Execution progress and todos: [`TODOS.md`](./TODOS.md) · Master plan: [`./product-and-engineering-plan.md`](./product-and-engineering-plan.md)

## Process boundaries

```text
React Renderer  --typed IPC + Zod-->  Electron Main
                                         |
                                    AgentRuntime
                                         |
                                   agent-pi adapter
                                         |
                                    Pi Agent SDK
```

- Renderer: UI only. No filesystem, shell, keychain, or SQLite.
- Preload: whitelist `invoke` + `onAgentEvent` only.
- Main: project trust, approvals, runtime, persistence, audit.

## Package dependency direction

```text
desktop → protocol, agent-domain, agent-pi
agent-pi → agent-domain, protocol
agent-domain → protocol
protocol → (zod only)
```

Renderer must not import `agent-pi` or Pi SDK packages.

## Event scoping

Every `DesktopAgentEvent` carries:

- `projectId`, `sessionId`, `runId`
- monotonic `sequence` per run
- `timestamp`

Renderer drops events whose `sequence` is not strictly greater than the last accepted sequence for that `runId`.
