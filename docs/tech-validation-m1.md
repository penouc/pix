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
| Provider login + model list + real call | [x] | OpenCode Go from `~/.local/share/opencode/auth.json`; eval fixture full tool loop PASS |
| Version locked + upgrade steps | [x] | ADR-0002 |

## Route decision (SDK vs Pi RPC)

| Option | Status |
|--------|--------|
| Continue in-process SDK | **Default / still preferred** — packaged dir build succeeded with Pi deps |
| Pi RPC stdin/stdout sidecar | Backup if packaged runtime fails on GUI smoke |

Decision: **continue SDK**. Evidence: headless `pnpm eval:fixture` with `opencode-go/kimi-k2.7-code` completed real read/edit/bash on fixture (2026-07-24). Packaged GUI smoke still optional.

## How to try

```bash
pnpm -r --filter './packages/*' build

# Real Pi — OpenCode Go (auto-reads ~/.local/share/opencode/auth.json):
pnpm dev
# Browse → fixture → Trust → New session → opencode-go model → send task

# Offline UI:
PI_DESKTOP_FAKE_RUNTIME=1 pnpm dev

# Headless real coding eval (default opencode-go/kimi-k2.7-code):
pnpm eval:fixture

# Headless Fake smoke:
pnpm smoke:runtime

# Packaged:
pnpm package:dir && pnpm smoke:packaged
```

## Fixture eval result (2026-07-24)

| Field | Value |
|-------|--------|
| Model | `opencode-go/kimi-k2.7-code` |
| Tools | read, edit, bash |
| Outcome | **PASS** — source + unit + acceptance |
| Report | [`eval-reports/react-button-label-latest.md`](./eval-reports/react-button-label-latest.md) |
