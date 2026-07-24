# M1 Tech Validation Log

> Living document for plan §7.2 / §18 items 5–13.  
> Related todos: [`TODOS.md`](./TODOS.md)

## Locked stack

| Component | Choice | Date |
|-----------|--------|------|
| Pi coding agent | `@earendil-works/pi-coding-agent@0.82.0` | 2026-07-24 |
| Pi agent core | `@earendil-works/pi-agent-core@0.82.0` | 2026-07-24 |
| Pi AI | `@earendil-works/pi-ai@0.82.0` | 2026-07-24 |
| Adapter | `PiAgentRuntime` in `packages/agent-pi` | 2026-07-24 |
| Fallback | `FakeAgentRuntime` via `PI_DESKTOP_FAKE_RUNTIME=1` | 2026-07-24 |

## Checklist

| Item | Status | Evidence |
|------|--------|----------|
| Pi SDK loads in Electron Main (dev) | [~] | createSession smoke test + wired in main; full GUI path TBD |
| Pi SDK loads in packaged Electron | [ ] | |
| ESM/CJS / dynamic deps / resources | [~] | main externalizes `@earendil-works/*` |
| Session storage path controllable | [x] | `agentDir` under `app.getPath('userData')/pi-agent` |
| Tool events for permission inputs | [~] | tool.requested includes name + inputSummary |
| Abort kills bash process tree | [ ] | abort() + abortBash() called; tree verification pending |
| No orphan processes on quit | [~] | dispose on before-quit |
| Provider login + model list + real call | [ ] | listModels offline catalog ok; real call needs auth |
| Version locked + upgrade steps | [x] | ADR-0002 |

## Route decision (SDK vs Pi RPC)

| Option | Status |
|--------|--------|
| Continue in-process SDK | **Default / in progress** |
| Pi RPC stdin/stdout sidecar | Backup if packaged native/ESM fails |

Decision: pending packaged build evidence.

## How to try

```bash
pnpm -r --filter './packages/*' build
pnpm dev
# Open a local project path → New session → Send message
# Without Pi credentials, expect run.failed with auth-related message (still proves IPC + adapter).

# Offline UI only:
PI_DESKTOP_FAKE_RUNTIME=1 pnpm dev
```
