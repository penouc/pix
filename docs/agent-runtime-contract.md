# AgentRuntime Contract

See `packages/agent-domain/src/runtime.ts` for the TypeScript interface.

## Responsibilities

| Layer | Owns |
|-------|------|
| Desktop domain | Session metadata, runs, approvals, checkpoints, projects |
| Pi adapter (`agent-pi`) | Pi session lifecycle, event mapping, model listing |
| Pi SDK | Model context, provider auth internals, tool execution primitives |

## FakeAgentRuntime

Used for:

- UI development without API cost
- Contract and E2E tests that must not call real models
- CI smoke of IPC + stream path

Toggle: `PI_DESKTOP_FAKE_RUNTIME=1` or `createAgentRuntime({ forceFake: true })`.

## Run state machine

```text
idle → starting → running ⇄ waiting_for_approval → stopping → completed|failed|cancelled
```

Illegal transitions are ignored (deterministic no-op), not thrown.
