import type { IpcCommand, IpcResult } from '@pi-desktop/protocol';

export class IpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

export async function invoke<T>(command: IpcCommand): Promise<T> {
  if (!window.piDesktop) {
    throw new IpcError('NO_BRIDGE', 'piDesktop preload bridge is not available');
  }
  const result: IpcResult<T> = await window.piDesktop.invoke<T>(command);
  if (!result.ok) {
    throw new IpcError(result.error.code, result.error.message);
  }
  return result.data;
}
