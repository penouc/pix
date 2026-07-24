# ADR 0001: Electron + Pi SDK

## Status

Accepted (2026-07-24)

## Context

We need a local desktop coding agent that embeds an existing multi-provider agent runtime without rebuilding provider adapters.

## Decision

- Desktop shell: **Electron** (Main + Preload + React Renderer)
- Agent kernel: **Pi Agent SDK**, isolated behind `AgentRuntime` / `packages/agent-pi`
- UI kit: React + TypeScript + Tailwind + shadcn-style primitives
- Diff (later): `@pierre/diffs`

## Consequences

- Fast integration with Node/TS Pi ecosystem
- Larger security surface than pure native apps — mitigated by process isolation, Zod IPC, Main-side policy engine
- Packaged build validation required early (native modules, ESM)
