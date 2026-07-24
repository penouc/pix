/** IPC channel names — single source of truth for Main / Preload / Renderer. */
export const IpcChannels = {
  invoke: 'pi:invoke',
  event: 'pi:event',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
