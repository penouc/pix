import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IpcChannels, type DesktopAgentEvent, type IpcCommand, type IpcResult } from '@pi-desktop/protocol';

/**
 * Minimal, whitelist-only bridge (plan §9.3).
 * No generic invoke of arbitrary channels from Renderer.
 */
const api = {
  invoke<T = unknown>(command: IpcCommand): Promise<IpcResult<T>> {
    return ipcRenderer.invoke(IpcChannels.invoke, command) as Promise<IpcResult<T>>;
  },
  onAgentEvent(listener: (event: DesktopAgentEvent) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: DesktopAgentEvent) => {
      listener(payload);
    };
    ipcRenderer.on(IpcChannels.event, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.event, handler);
    };
  },
} as const;

export type PiDesktopApi = typeof api;

contextBridge.exposeInMainWorld('piDesktop', api);
