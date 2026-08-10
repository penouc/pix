# ADR-0005: Browser Preview Host — WebContentsView + Loopback-First Selection

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** plan C8 (Browser tool), [`omp-capability-borrow.md`](../omp-capability-borrow.md) §I browser, Dock `browser` tab

## Background

The right-dock Browser tab shipped as a sandboxed `<iframe>` (VS Code Simple Browser style). That
is safe and enough for “look at localhost,” but it cannot:

- read a cross-origin DOM or text selection,
- run an element picker,
- or feed structured page context into the Composer.

Cursor / Codex-style “select in the preview, then change source” needs a privileged page host.
Product plan C8 marks a full agent browser (navigate / click / screenshot tools) as High risk.
This ADR locks the **P1** host and policy so we can ship select-to-composer without opening the
full agent driving surface yet.

## Decision

### 1. Host: in-process `WebContentsView` (not external Chromium / CDP)

| Option | Verdict |
|--------|---------|
| Keep sandboxed iframe | Rejected for P1 — cannot read selection across origins |
| External Chromium + CDP (Puppeteer/Playwright) | Deferred — heavier install, second process, same security review as C8 agent tools |
| Electron `WebContentsView` | **Chosen** — recommended Electron alternative to `<webview>`, lives in the Dock, Main owns lifecycle |

The guest page uses `sandbox: true`, `contextIsolation: true`, no Node, no app preload. Popups
are denied; http(s) may open via `shell.openExternal`. Navigation is limited to `http:` / `https:`.

Bounds are driven by the Renderer measuring the Dock content rect (`browser.setBounds`). The
view is hidden when the Browser tab is inactive or the Dock is closed.

### 2. P1 product loop: user pick → Composer → existing file edit

- User starts **Select** in the Browser chrome.
- Main injects a one-shot picker into the guest page, captures selector / text / HTML snippet /
  optional cropped screenshot.
- Renderer inserts that payload into the Composer (text + optional image attachment).
- The agent still edits **workspace source** through existing tools (`edit`, Diff, Checkpoint).
  No live-DOM write tool in P1.

Agent-driven navigate / click / snapshot tools remain **out of scope** (P2 / C8).

### 3. Per-origin policy (loopback-first)

| Action | Loopback (`localhost`, `127.0.0.1`, `[::1]`) | Other http(s) |
|--------|-----------------------------------------------|---------------|
| Navigate / reload / history | Allowed | Allowed (preview only) |
| Element picker + screenshot into Composer | **Allowed** | **Denied** (`BROWSER_ORIGIN_DENIED`) |
| Agent browser tools | N/A (not shipped) | N/A |

Non-loopback picking waits on an explicit per-origin approval story (remembered grant, audit,
Plan Mode rules). Until that exists, external sites stay view-only in the Dock.

`file:`, `devtools:`, and other schemes are never loadable in the preview host.

## Consequences

- Main gains a small `browser/*` service and `browser.*` IPC methods; the iframe path is removed.
- Layout coupling: Dock resize / tab switches must keep `setBounds` / `setVisible` in sync, or the
  native view will paint over the wrong chrome.
- Security surface grows versus iframe (real renderer, cookies for that session partition) but
  stays narrower than C8 because the agent cannot drive the page.
- Follow-up (not this ADR): per-origin allowlist UI, agent `browser_*` tools, and locking the
  page while the agent acts.

## Acceptance (P1)

- Opening the Browser tab shows a `WebContentsView` aligned to the Dock content area.
- Loopback pages support Select → Composer insert (markdown context; screenshot optional).
- Non-loopback Select fails with a clear error; navigation still works.
- Closing the Dock / leaving the tab hides the view; window close destroys it.
- No agent browser tools are registered.