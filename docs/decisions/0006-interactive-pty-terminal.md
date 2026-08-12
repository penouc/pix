# ADR-0006: Interactive PTY Terminal (xterm.js + node-pty)

- **Status:** Accepted
- **Date:** 2026-08-12
- **Related:** plan Terminal panel / M13, ADR-0004 (Windows Git Bash dialect), Dock `terminal` tab

## Background

The Terminal panel shipped as a one-shot command runner: each line was
`spawn`ed, captured, capped, and printed into a text log. That matched an early
safety story (per-command cwd confinement, policy on every line) but could not
run a real shell — no ANSI colors, no `vim` / `top` / `less` / REPLs, no resize,
and no Ctrl+C via a PTY.

The agent already has a separate non-interactive `bash` tool gated by the
permission pipeline. The UI terminal needs a persistent interactive session
without weakening that agent path.

## Decision

### 1. Host: xterm.js in Renderer + node-pty in Main

| Option | Verdict |
|--------|---------|
| Keep one-shot spawn | Rejected — not a terminal |
| libghostty / Ghostty embed | Rejected — out of scope; stick to xterm.js + node-pty |
| xterm.js + node-pty | **Chosen** — standard Electron pattern; FitAddon resize; control chars via `onData` |

- **Renderer:** `@xterm/xterm` + FitAddon (+ WebLinksAddon). Theme tokens follow
  `--color-output` / accent greens so the surface still reads as the existing
  output panel, not a second chrome theme.
- **Main:** `PtySessionService` owns `node-pty` processes. Lifecycle IPC:
  `terminal.open` / `write` / `resize` / `close`. Output streams as
  `terminal.data` / `terminal.exit` events (base64-safe chunks).
- **Agent bash:** unchanged. `TerminalService.exec` remains available for any
  non-interactive / policy-audited one-shot use; the panel no longer drives it.

### 2. Shell selection

| Platform | Shell |
|----------|--------|
| macOS / Linux | `$SHELL` if present, else `/bin/bash`, then `/bin/zsh` — login shell (`-l`) |
| Windows | Git Bash via existing `resolveBashPath()` — `bash -l -i`. If missing, clear error pointing at Git for Windows (same spirit as ADR-0004) |

Sessions start in the **project workspace root** (or a Main-validated cwd inside
it). Tabs each own one PTY; closing a tab kills that PTY.

### 3. Permission / security philosophy

Opening and using the Terminal panel is **user-initiated**. Interactive typing
is consent — the same spirit as today’s auto-`allow-once` for typed one-shot
commands. We do **not** pop an approval dialog for every keystroke.

Still enforced:

- Refuse `terminal.open` without a trusted/open project.
- Start cwd is confined to the project workspace (canonicalize +
  `isPathInsideWorkspace`).
- Audit session open / close / notable exits to the existing terminal NDJSON
  audit log (`toolName: terminal.pty`).
- Agent bash policy denials and approvals are **unchanged** and must not be
  weakened by this feature.

Honest limit (not a chroot):

> A live interactive shell can `cd` outside the workspace after start. The old
> per-command runner re-validated cwd on every line; a PTY cannot do that
> without filesystem jail / OS sandboxing. We document this rather than block
> the feature on a jail. Optional follow-up: surface cwd in the tab title via
> OSC 7 / shell integration — not required for v1.

### 4. Packaging

`electron-builder` keeps `npmRebuild: false` / `nodeGypRebuild: false`. Native
`node-pty` is rebuilt for Electron’s ABI via `@electron/rebuild` (`pnpm
rebuild:native` / postinstall hook). `asarUnpack` already includes `**/*.node`;
`node-pty` is listed in `pnpm.onlyBuiltDependencies` so install scripts run.

## Consequences

- Terminal UI becomes a real PTY (colors, TUIs, resize, signals).
- Security reviewers must treat the panel as “user shell with project-root
  start,” not “workspace-jailed command sandbox.”
- Packaging/CI must rebuild `node-pty` against Electron 36 on macOS arm64 and
  Windows x64 before packaging.
- Product copy that said “interactive programs are not supported” is removed.

## Acceptance

- Each Terminal tab is a persistent PTY; `+` opens a new session; close kills it.
- ANSI colors, interactive programs, FitAddon→`pty.resize`, and Ctrl+C work by
  design.
- macOS/Linux and Windows shell selection match §2.
- Agent bash tool / policy path remains separate and intact.
- ADR documents the interactive vs agent permission split and the cwd honesty
  note above.
