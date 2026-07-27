# PiX

A local desktop coding agent powered by the [Pi Agent SDK](https://github.com/earendil-works/pi). Open a Git project on your machine and complete the loop: understand the task → edit code → verify → review the diff → keep or revert.

> Product & engineering plan: [`docs/product-and-engineering-plan.md`](./docs/product-and-engineering-plan.md)  
> Execution todos & progress: [`docs/TODOS.md`](./docs/TODOS.md)

## Status

See [`docs/TODOS.md`](./docs/TODOS.md) for the authoritative checklist. Summary:

- **M0**: Not fully closed (eval suite and documentation set still incomplete)
- **M1+**: Electron shell, Zod IPC, and real Pi SDK runtime are in place; keep validating packaged builds and the full acceptance path

## Repository layout

```text
apps/desktop/          Electron Main / Preload / React Renderer
packages/protocol/     Typed IPC + Zod schemas + DesktopAgentEvent
packages/agent-domain/ AgentRuntime boundary, state machine, domain errors
packages/agent-pi/     Pi adapter (PiAgentRuntime + FakeAgentRuntime)
docs/                  Architecture, contracts, and product docs
fixtures/              Fixed eval / test repositories
```

## Development

```bash
pnpm install
pnpm --filter @pi-desktop/protocol build
pnpm --filter @pi-desktop/agent-domain build
pnpm --filter @pi-desktop/agent-pi build
pnpm --filter @pi-desktop/database build
pnpm --filter @pi-desktop/security build
pnpm dev
```

After the app launches:

1. Open a local project folder from the sidebar
2. Create a **New task**
3. Send a message and watch streaming replies plus tool cards
4. Use **Stop** to cancel an in-flight run

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Electron + Vite in development (real Pi by default) |
| `PI_DESKTOP_FAKE_RUNTIME=1 pnpm dev` | Offline Fake Runtime |
| `pnpm typecheck` | Workspace typecheck |
| `pnpm test` | Vitest |
| `pnpm test:fixture` | Fixed eval fixture baseline tests |
| `pnpm lint` | ESLint |
| `pnpm build` | Build packages + desktop |
| `pnpm package:dir` | macOS arm64 directory package (electron-builder) |
| `pnpm smoke:packaged` | Check packaged app asar / Pi deps |
| `pnpm smoke:runtime` | Headless Fake Runtime streaming smoke |
| `pnpm smoke:runtime:pi` | Headless real Pi `createSession` (packages must be built) |

For live model calls, prefer **OpenCode Go** (reads `~/.local/share/opencode/auth.json`, or set `OPENCODE_API_KEY`). The Auth line in the UI shows which providers are ready.

```bash
pnpm eval:fixture   # headless real-edit acceptance (default opencode-go/kimi-k2.7-code)
```

## Architecture constraints (summary)

- Renderer has **no** Node integration; communication goes through a Preload whitelist only
- All IPC inputs, outputs, and events are validated with Zod (`@pi-desktop/protocol`)
- Pi SDK types may only appear in `packages/agent-pi`; the UI never imports Pi types
- Permission decisions run in the Main process; checkpoint snapshots are the source of truth for recovery

## Product docs

| Doc | Description |
|-----|-------------|
| [`docs/product-and-engineering-plan.md`](./docs/product-and-engineering-plan.md) | Product & engineering master plan |
| [`docs/product-scope.md`](./docs/product-scope.md) | MVP in / out of scope freeze |
| [`docs/architecture.md`](./docs/architecture.md) | Process boundaries and package graph |
| [`docs/TODOS.md`](./docs/TODOS.md) | Milestone todos and acceptance gates |
| [`docs/decisions/`](./docs/decisions/) | Architecture decision records |

## Acknowledgments

Huge thanks to **[Pi](https://github.com/earendil-works/pi)** — the open-source coding agent that powers this desktop app. PiX stands on the shoulders of the Pi Agent team and community.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=penouc/pix&type=Date)](https://www.star-history.com/#penouc/pix&Date)
