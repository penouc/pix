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
| Pi SDK loads in Electron Main (dev) | [~] | createSession smoke test + Main wiring; GUI real prompt needs API key |
| Pi SDK loads in packaged Electron | [~] | `pnpm package:dir` + `node scripts/smoke-packaged.mjs` verifies bundle/asar/Pi unpack; interactive GUI launch still manual |
| ESM/CJS / dynamic deps / resources | [~] | main externalizes `@earendil-works/*`; builder packs deps |
| Session storage path controllable | [x] | `agentDir` under `app.getPath('userData')/pi-agent` |
| Tool events for permission inputs | [~] | tool.requested includes name + inputSummary + risk heuristic |
| Abort kills bash process tree | [~] | `killProcessTree` unit tests pass; Pi abort/abortBash on session; full agent-bash integration TBD |
| No orphan processes on quit | [~] | dispose on before-quit |
| Provider login + model list + real call | [~] | env key hydrate + Auth status IPC; real LLM call needs user keys |
| Version locked + upgrade steps | [x] | ADR-0002 |

## Route decision (SDK vs Pi RPC)

| Option | Status |
|--------|--------|
| Continue in-process SDK | **Default / still preferred** — packaged dir build succeeded with Pi deps |
| Pi RPC stdin/stdout sidecar | Backup if packaged runtime fails on GUI smoke |

Decision: **continue SDK** pending manual GUI smoke of packaged app + one authenticated prompt.

## How to try

```bash
pnpm -r --filter './packages/*' build
# Real Pi (set at least one provider key):
export OPENAI_API_KEY=...   # or ANTHROPIC_API_KEY / XAI_API_KEY / ...
pnpm dev
# Open fixtures/test-repositories/react-button-label (run setup-git.sh first for Git trust)
# New session → send task from fixture README

# Offline UI only:
PI_DESKTOP_FAKE_RUNTIME=1 pnpm dev

# Process-tree unit tests:
pnpm test -- packages/agent-pi/src/process-tree.test.ts

# Headless runtime (Fake by default):
pnpm smoke:runtime
# Real Pi session create/list (no prompt unless SMOKE_PROMPT=1 + API key):
pnpm smoke:runtime:pi
# SMOKE_PROMPT=1 PI_DESKTOP_FAKE_RUNTIME=0 pnpm smoke:runtime:pi

# Packaged macOS arm64 dir:
pnpm package:dir
# open apps/desktop/release/mac-arm64/Pi\ Agent\ Desktop.app
```
