# Agent notes

## Local development

- Node.js 22+ and pnpm 10.15.0 are required (`packageManager` in root `package.json`).
- Install: `pnpm install --frozen-lockfile`, then `pnpm rebuild:native` so `node-pty` matches Electron’s ABI.
- Unit tests: `pnpm test`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.
- Marketing site: `pnpm dev:website` (Vite, port 5174).
- Desktop app: `pnpm dev` (Electron + Vite on port 5173). For UI-only work without provider keys, use `PI_DESKTOP_FAKE_RUNTIME=1 pnpm dev`.

## Cursor Cloud specific instructions

- This repo is a pnpm workspace. The supported desktop targets are macOS Apple Silicon and Windows x64; Linux is fine for install, tests, package builds, and the website.
- Do not start long-running servers in `install`. Dependencies and `packages/*` builds belong in the environment install script; the website belongs in `terminals`.
- Fake Runtime smoke (no API keys): `pnpm smoke:runtime`.
- Playwright Electron e2e needs a prior `pnpm build` and a display (`xvfb-run` on Linux).
- Git fixture tests disable `commit.gpgsign` locally. Cloud Agent VMs enable global commit signing; do not re-enable it in temp test repos.
- Linux Electron (optional): `PI_DESKTOP_FAKE_RUNTIME=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a pnpm dev`.
