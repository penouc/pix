import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  COMPANION_ALLOWED_METHODS,
  COMPANION_DEFAULT_PORT,
  parseCompanionClientMessage,
  type CompanionHostMessage,
  type CompanionStatus,
  type IpcResult,
} from '@pi-desktop/protocol';

export interface AgentHostOptions {
  port?: number;
  pairingCode: string;
  /** Resolve an IPC command the same way the desktop renderer does. */
  invoke: (raw: unknown) => Promise<IpcResult>;
  /** Directory of the built companion SPA; optional in early Phase 1. */
  staticRoot?: string;
}

interface AuthedClient {
  socket: WebSocket;
  clientName?: string;
}

/**
 * Local LAN companion host: HTTP serves the phone UI; WebSocket carries the
 * same invoke/event contract as desktop IPC, gated by a pairing code.
 */
export class AgentHostServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<AuthedClient>();
  private pending = new Map<WebSocket, { timer: ReturnType<typeof setTimeout> }>();
  private running = false;
  private port = COMPANION_DEFAULT_PORT;
  private pairingCode: string;
  private readonly invoke: AgentHostOptions['invoke'];
  private readonly staticRoot?: string;

  constructor(options: AgentHostOptions) {
    this.pairingCode = options.pairingCode;
    this.port = options.port ?? COMPANION_DEFAULT_PORT;
    this.invoke = options.invoke;
    this.staticRoot = options.staticRoot;
  }

  getStatus(enabled: boolean): CompanionStatus {
    return {
      enabled,
      running: this.running,
      port: this.port,
      pairingCode: this.pairingCode,
      urls: this.running ? listLanUrls(this.port) : [],
      clients: this.clients.size,
    };
  }

  setPairingCode(code: string): void {
    this.pairingCode = code;
  }

  getPairingCode(): string {
    return this.pairingCode;
  }

  async start(port = this.port): Promise<void> {
    if (this.running) return;
    this.port = port;

    const http = createServer((req, res) => {
      void this.handleHttp(req, res);
    });

    const wss = new WebSocketServer({ server: http, path: '/ws' });
    wss.on('connection', (socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.port, '0.0.0.0', () => {
        http.off('error', reject);
        resolve();
      });
    });

    this.http = http;
    this.wss = wss;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    for (const [socket, pending] of this.pending) {
      clearTimeout(pending.timer);
      socket.close(4001, 'host stopped');
    }
    this.pending.clear();

    for (const client of this.clients) {
      client.socket.close(1001, 'host stopped');
    }
    this.clients.clear();

    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      this.wss = null;
    });

    await new Promise<void>((resolve) => {
      this.http?.close(() => resolve());
      this.http = null;
    });
  }

  /** Fan out a validated DesktopAgentEvent to every paired phone. */
  broadcastEvent(event: unknown): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify({ type: 'event', event } satisfies { type: 'event'; event: unknown });
    for (const client of this.clients) {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(payload);
      }
    }
  }

  private handleConnection(socket: WebSocket): void {
    const timer = setTimeout(() => {
      this.pending.delete(socket);
      this.send(socket, {
        type: 'hello.err',
        error: { code: 'PAIRING_TIMEOUT', message: 'Send hello with the pairing code within 15s.' },
      });
      socket.close(4002, 'pairing timeout');
    }, 15_000);
    this.pending.set(socket, { timer });

    socket.on('message', (data) => {
      void this.handleMessage(socket, data.toString());
    });
    socket.on('close', () => {
      const pending = this.pending.get(socket);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(socket);
      }
      for (const client of this.clients) {
        if (client.socket === socket) this.clients.delete(client);
      }
    });
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.send(socket, {
        type: 'hello.err',
        error: { code: 'INVALID_JSON', message: 'Expected a JSON message.' },
      });
      return;
    }

    const parsed = parseCompanionClientMessage(json);
    if (!parsed.success) {
      // Unauthenticated sockets only speak hello; after auth, bad invokes get a result.
      if (this.pending.has(socket)) {
        this.send(socket, {
          type: 'hello.err',
          error: { code: 'INVALID_HELLO', message: parsed.error.message },
        });
        socket.close(4003, 'invalid hello');
      }
      return;
    }

    const msg = parsed.data;
    if (msg.type === 'hello') {
      this.authenticate(socket, msg.pairingCode, msg.clientName);
      return;
    }

    const client = [...this.clients].find((entry) => entry.socket === socket);
    if (!client) {
      this.send(socket, {
        type: 'hello.err',
        error: { code: 'NOT_PAIRED', message: 'Send hello before invoke.' },
      });
      return;
    }

    if (!COMPANION_ALLOWED_METHODS.includes(msg.method)) {
      this.send(socket, {
        type: 'result',
        id: msg.id,
        result: { ok: false, error: { code: 'METHOD_FORBIDDEN', message: `${msg.method} is not available on companion` } },
      });
      return;
    }

    const result = await this.invoke({
      method: msg.method,
      ...(msg.params !== undefined ? { params: msg.params } : {}),
    });
    this.send(socket, { type: 'result', id: msg.id, result });
  }

  private authenticate(socket: WebSocket, pairingCode: string, clientName?: string): void {
    const pending = this.pending.get(socket);
    if (!pending) {
      this.send(socket, {
        type: 'hello.err',
        error: { code: 'ALREADY_PAIRED', message: 'Already authenticated.' },
      });
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(socket);

    if (pairingCode.trim() !== this.pairingCode) {
      this.send(socket, {
        type: 'hello.err',
        error: { code: 'BAD_PAIRING_CODE', message: 'Pairing code does not match.' },
      });
      socket.close(4004, 'bad pairing code');
      return;
    }

    this.clients.add({ socket, clientName });
    this.send(socket, {
      type: 'hello.ok',
      status: { port: this.port, urls: listLanUrls(this.port) },
    });
  }

  private send(socket: WebSocket, message: CompanionHostMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === '/health' || req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          name: 'PiX Companion',
          port: this.port,
          clients: this.clients.size,
        }),
      );
      return;
    }

    if (!this.staticRoot || !existsSync(this.staticRoot)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fallbackCompanionHtml());
      return;
    }

    const urlPath = (req.url ?? '/').split('?')[0] || '/';
    const safeRel =
      urlPath === '/' ? 'index.html' : path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(this.staticRoot, safeRel);
    if (!filePath.startsWith(this.staticRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      const index = path.join(this.staticRoot, 'index.html');
      if (existsSync(index)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        createReadStream(index).pipe(res);
        return;
      }
      res.writeHead(404).end('Not found');
      return;
    }

    res.writeHead(200, { 'content-type': contentType(filePath) });
    createReadStream(filePath).pipe(res);
  }
}

export function generatePairingCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function listLanUrls(port: number): string[] {
  const urls: string[] = [];
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  if (urls.length === 0) urls.push(`http://127.0.0.1:${port}`);
  return urls;
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

/** Minimal phone UI when the companion SPA has not been built yet. */
function fallbackCompanionHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>PiX Companion</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 24px; background: #0f1115; color: #f4f4f5; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    p { color: #a1a1aa; line-height: 1.5; }
    input, button { font: inherit; padding: 12px 14px; border-radius: 12px; border: 1px solid #3f3f46; width: 100%; box-sizing: border-box; }
    input { background: #18181b; color: inherit; margin: 8px 0 12px; }
    button { background: #fafafa; color: #09090b; font-weight: 600; border: 0; }
    #log { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; margin-top: 20px; color: #d4d4d8; }
    .ok { color: #4ade80; } .err { color: #f87171; }
  </style>
</head>
<body>
  <h1>PiX Companion</h1>
  <p>Enter the pairing code from PiX → Settings → Companion.</p>
  <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" />
  <button id="connect">Connect</button>
  <div id="log"></div>
  <script>
    const log = (msg, cls) => {
      const el = document.createElement('div');
      if (cls) el.className = cls;
      el.textContent = msg;
      document.getElementById('log').prepend(el);
    };
    const pending = new Map();
    let ws;
    document.getElementById('connect').onclick = () => {
      const code = document.getElementById('code').value.trim();
      if (!code) return;
      if (ws) ws.close();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws');
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', pairingCode: code, clientName: 'fallback-web' }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'hello.ok') {
          log('Paired. Loading sessions…', 'ok');
          const id = crypto.randomUUID();
          pending.set(id, true);
          ws.send(JSON.stringify({ type: 'invoke', id, method: 'session.list', params: {} }));
        } else if (msg.type === 'hello.err') {
          log(msg.error.message, 'err');
        } else if (msg.type === 'result') {
          log(JSON.stringify(msg.result, null, 2));
        } else if (msg.type === 'event') {
          log(msg.event.type + (msg.event.delta ? ': ' + msg.event.delta : ''));
        }
      };
      ws.onclose = () => log('Disconnected', 'err');
      ws.onerror = () => log('Socket error', 'err');
    };
  </script>
</body>
</html>`;
}

/** Resolve companion SPA dist next to the monorepo when running from source. */
export function resolveCompanionStaticRoot(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../../companion/dist'),
    path.resolve(here, '../../../../../apps/companion/dist'),
    path.resolve(process.cwd(), 'apps/companion/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}
