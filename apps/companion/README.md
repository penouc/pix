# PiX Companion (Phase 1)

Phone UI for the local companion host embedded in the desktop app.

## Use with desktop host

1. In PiX: **Settings → Companion → Enable companion host**
2. Note the pairing code and LAN URL (e.g. `http://192.168.1.10:7847`)
3. Build and serve the SPA from the host:

```bash
pnpm build:companion
```

Then open the LAN URL on your phone (same Wi‑Fi). Enter the pairing code.

During development you can also run the companion Vite server separately:

```bash
pnpm dev:companion
```

Point **Host** at your Mac’s LAN address and port `7847`.

## Capabilities

- Session list
- Streaming chat + thinking + tool cards
- Send message / follow-up
- Approve or deny tool requests

Diff review, terminal, and automations remain desktop-only in Phase 1.
