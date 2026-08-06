import {
  parseCompanionHostMessage,
  type CompanionAllowedMethod,
  type CompanionHostMessage,
  type DesktopAgentEvent,
  type IpcResult,
} from '@pi-desktop/protocol';

type EventHandler = (event: DesktopAgentEvent) => void;
type StatusHandler = (connected: boolean) => void;

function storageKey(key: string): string {
  return `pix.companion.${key}`;
}

export function loadSavedHost(): string {
  return localStorage.getItem(storageKey('host')) ?? guessDefaultHost();
}

export function loadSavedCode(): string {
  return localStorage.getItem(storageKey('code')) ?? '';
}

export function saveConnection(host: string, code: string): void {
  localStorage.setItem(storageKey('host'), host);
  localStorage.setItem(storageKey('code'), code);
}

function guessDefaultHost(): string {
  // When served from the desktop companion host, location.host is correct.
  if (typeof location !== 'undefined' && location.port === '7847') {
    return location.host;
  }
  if (typeof location !== 'undefined' && location.hostname && location.hostname !== 'localhost') {
    return `${location.hostname}:7847`;
  }
  return '127.0.0.1:7847';
}

function toWsUrl(host: string): string {
  const cleaned = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const proto = cleaned.startsWith('localhost') || cleaned.startsWith('127.') ? 'ws' : 'ws';
  // Prefer wss only if the page itself is https (future tunnel).
  const scheme = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : proto;
  return `${scheme}://${cleaned}/ws`;
}

export class CompanionClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (value: IpcResult) => void; reject: (error: Error) => void }>();
  private eventHandlers = new Set<EventHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private paired = false;

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  get connected(): boolean {
    return this.paired && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(host: string, pairingCode: string, clientName = 'companion-web'): Promise<void> {
    this.disconnect();
    saveConnection(host, pairingCode);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(toWsUrl(host));
      this.ws = ws;
      let settled = false;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        this.setPaired(false);
        reject(new Error(message));
      };

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', pairingCode, clientName }));
      });

      ws.addEventListener('message', (ev) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(ev.data));
        } catch {
          fail('Invalid host message');
          return;
        }
        const parsed = parseCompanionHostMessage(raw);
        if (!parsed.success) return;
        const msg = parsed.data;

        if (msg.type === 'hello.ok') {
          if (!settled) {
            settled = true;
            this.setPaired(true);
            resolve();
          }
          return;
        }
        if (msg.type === 'hello.err') {
          fail(msg.error.message);
          ws.close();
          return;
        }
        this.dispatch(msg);
      });

      ws.addEventListener('close', () => {
        this.setPaired(false);
        for (const [, entry] of this.pending) {
          entry.reject(new Error('Disconnected'));
        }
        this.pending.clear();
        if (!settled) fail('Connection closed');
      });

      ws.addEventListener('error', () => {
        fail('Could not reach PiX companion host');
      });
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.setPaired(false);
  }

  async invoke<T = unknown>(method: CompanionAllowedMethod, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.paired) {
      throw new Error('Not connected');
    }
    const id = crypto.randomUUID();
    const result = await new Promise<IpcResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(
        JSON.stringify({
          type: 'invoke',
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
      );
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.data as T;
  }

  private dispatch(msg: CompanionHostMessage): void {
    if (msg.type === 'result') {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        pending.resolve(msg.result as IpcResult);
      }
      return;
    }
    if (msg.type === 'event') {
      for (const handler of this.eventHandlers) handler(msg.event);
    }
  }

  private setPaired(value: boolean): void {
    this.paired = value;
    for (const handler of this.statusHandlers) handler(value);
  }
}

export const companionClient = new CompanionClient();
