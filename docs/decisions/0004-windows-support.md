# ADR-0004: Windows x64 Support — Build, Shell, and Security Decisions

- **Status:** Accepted
- **Date:** 2026-08-01
- **Related:** master plan §24.7 (Cross-platform), §9 (Permission and Security Model), `docs/TODOS.md`
  M8-4, `docs/macos-signing.md`

## Background

PiX launched macOS-first (Apple Silicon). The architecture was designed not to lock out other
desktop platforms (plan §1.3), but shipping a Windows build still required explicit decisions on
four things the macOS build never had to think about: which shell commands run through, how a
runaway process tree is terminated, how credential encryption is described (and enforced), and
which package/update story Windows users get.

This ADR records those decisions and the boundaries of the first Windows release.

## First Release Scope

| Item | Decision |
|------|----------|
| OS | Windows 10 / 11 (x64) |
| Arch | x64 only; ARM64 is future work |
| Installer | NSIS `.exe` (per-user, no admin/UAC, assisted install) |
| Portable | `.zip` (electron-builder `zip` target) |
| Auto-update | `electron-updater` via `latest.yml` (NSIS is the only target that emits it) |
| Shell for commands | Git Bash (Git for Windows) |
| Distribution | GitHub Releases; store / MSI / enterprise channels are out of scope |

## Decisions

### 1. Git Bash is the single command dialect (agent + Terminal panel)

Pi (and therefore PiX's agent) requires bash on Windows; the SDK resolves it in this order:
custom `shellPath` → `C:\Program Files\Git\bin\bash.exe` → `bash.exe` on PATH (Cygwin/MSYS2/WSL).

The Terminal panel previously spawned with `shell: true`, which on Windows means `cmd.exe`. That
would leave the user's Terminal speaking a different dialect from the agent, and — worse — the
security classifier (`risk-classifier.ts`) recognises `rm -rf`, `curl`, `git push`, and friends by
their bash spelling. `del /s`, `rmdir /s /q`, `Remove-Item -Recurse -Force`, and
`Invoke-WebRequest` would slip past those rules.

**Decision:** the Terminal panel resolves the same bash executable (via
`platform/environment.ts#resolveBashPath`) and runs `bash -c <command>`. macOS/Linux keep
`shell: true`. When bash is genuinely absent, Terminal commands fail with an explicit
"install Git for Windows" message instead of silently switching to cmd.exe.

**Consequence:** Workspace Trust, permission policies, and audit cover Windows commands with the
exact same rules as macOS. A startup preflight (`app.getInfo().preflight`) surfaces Git Bash
availability; the UI shows a dismissible banner and an About row when it is missing.

### 2. Process-tree termination uses `taskkill /T /F` on Windows

Unix kills a detached process group with `process.kill(-pid, SIGKILL)`. Windows has no POSIX
signals or process groups, so that call throws and leaves orphans behind.

**Decision:** a shared `killProcessTree` in `apps/desktop/src/main/platform/process-tree.ts` is the
single termination path for Terminal timeouts/cancels: `taskkill /PID <pid> /T /F` on win32,
process-group SIGKILL elsewhere. (The agent's own `packages/agent-pi` already used taskkill;
Main now has one module instead of two divergent implementations.)

### 3. Credential encryption is OS-level (safeStorage), and the copy says so

Electron's `safeStorage` encrypts with the macOS Keychain on macOS and DPAPI on Windows. The
implementation was already backend-agnostic; only the messages named macOS.

**Decision:** the error path and Settings copy now say "OS-level credential encryption" /
"macOS Keychain / Windows DPAPI" per platform. `isEncryptionAvailable()` is still enforced at
write time — a machine with no working encryption backend cannot silently store plaintext keys.

### 4. Path semantics: `node:path`, realpath, LF everywhere

`canonicalizePath`/`isPathInsideWorkspace` already run through `node:path` + `realpathSync.native`,
which behave correctly for drive letters and case-insensitive filesystems. `hashline-edit`
normalises `\r\n` before hashing, so CRLF workspaces do not break anchored edits.

**Decision:** add `.gitattributes` (`* text=auto eol=lf`) so CI and user checkouts are LF — a
Windows checkout with default `core.autocrlf=true` would otherwise turn every text file CRLF and
break both string-comparison tests and line hashing. Windows CI (`windows-check` in `ci.yml`)
guards this permanently.

### 5. Window chrome: native frame on Windows

`titleBarStyle: 'hiddenInset'` is macOS-specific styling. On Windows it is ignored, but keeping it
spread across the BrowserWindow options implied a hidden title bar that does not exist.

**Decision:** `hiddenInset` + `trafficLightPosition` are set only on darwin; Windows uses the
native frame so close/minimise/drag behave like every other Windows app.

### 6. Release pipeline: parallel per-platform builds, one publish

Cross-compiling Windows from a macOS runner would not validate DPAPI, Git Bash lookup, NSIS
install, Windows process termination, or the Windows update feed.

**Decision:** `release.yml` splits into `validate-version` → parallel `build-macos` /
`build-windows` → single `publish` job that downloads both artifact sets and creates the GitHub
Release once (no race between jobs). Windows signing is driven by `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` secrets; when absent, `forceCodeSigning=false` ships an unsigned beta
installer (SmartScreen warns — documented on the site and README), and when present the build
fails if signing cannot be completed.

### 7. Non-goals for the first Windows release

- Windows ARM64, MSI, Microsoft Store.
- A Settings UI for a custom Git Bash path (Pi's `shellPath` setting already covers advanced
  users; a UI can follow).
- WSL workspaces, Jump List, taskbar run-count badge, per-user "env fix" wizard.

## Acceptance Criteria (from plan §8)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass on `windows-latest` in CI.
- `pnpm package:win` produces NSIS `.exe`, `.zip`, `latest.yml`, and `.exe.blockmap`.
- Fresh Windows 11 x64 install launches; a Chinese/space-containing project path works.
- Provider keys round-trip through DPAPI (`safeStorage`).
- The agent can read/write/edit/bash/git; diff, checkpoint, keep/revert work.
- Cancelling/stopping a long command leaves no orphaned `bash.exe`/`node.exe`/`cmd.exe`.
- Windows notifications click through and focus the window.
- A beta.1 → beta.2 auto-update round-trip preserves projects, keys, sessions, and settings.
- Signed builds verify with `Get-AuthenticodeSignature` (once `WIN_CSC_*` secrets exist).
