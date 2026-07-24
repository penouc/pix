# IPC Protocol

Channels (`packages/protocol/src/channels.ts`):

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `pi:invoke` | Renderer → Main | Command envelope |
| `pi:event` | Main → Renderer | `DesktopAgentEvent` stream |

## Commands

Discriminated union on `method`. Full schema: `IpcCommandSchema` in `@pi-desktop/protocol`.

MVP methods:

- `app.getInfo`
- `project.open` / `project.listRecent`
- `session.create` / `session.list`
- `agent.sendMessage` / `agent.abort` / `agent.setModel` / `agent.resolveApproval` / `agent.listModels`

## Security

- No generic `ipcRenderer.invoke(channel, ...)` exposure
- Every payload validated with Zod on the Main boundary
- Invalid agent events are dropped before broadcast
