# Architecture

> 执行进度与 todos：[`TODOS.md`](./TODOS.md) · 总纲：[`../Pi_Agent_Desktop_开发总计划.md`](../Pi_Agent_Desktop_开发总计划.md)

## Process boundaries

```text
React Renderer  --typed IPC + Zod-->  Electron Main
                                         |
                                    AgentRuntime
                                         |
                                   agent-pi adapter
                                         |
                                    Pi Agent SDK (future)
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
