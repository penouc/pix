import { describe, expect, it, vi } from 'vitest';

import { COMPANION_DEFAULT_PORT } from '@pi-desktop/protocol';

import { AgentHostServer, generatePairingCode } from './agent-host-server.js';

describe('generatePairingCode', () => {
  it('returns a six-digit string', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('AgentHostServer', () => {
  it('reports idle status before start', () => {
    const host = new AgentHostServer({
      pairingCode: '123456',
      invoke: async () => ({ ok: true, data: null }),
    });
    const status = host.getStatus(false);
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(status.port).toBe(COMPANION_DEFAULT_PORT);
    expect(status.pairingCode).toBe('123456');
    expect(status.clients).toBe(0);
  });

  it('starts, accepts a paired invoke, and stops', async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, data: [{ id: 's1' }] }));
    const port = 18_000 + Math.floor(Math.random() * 1000);
    const testHost = new AgentHostServer({
      port,
      pairingCode: '654321',
      invoke,
    });

    await testHost.start();
    expect(testHost.getStatus(true).running).toBe(true);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('ws open failed')));
    });

    const hello = await new Promise<unknown>((resolve, reject) => {
      ws.addEventListener('message', (ev) => resolve(JSON.parse(String(ev.data))), { once: true });
      ws.addEventListener('error', () => reject(new Error('ws message failed')));
      ws.send(JSON.stringify({ type: 'hello', pairingCode: '654321', clientName: 'test' }));
    });
    expect(hello).toMatchObject({ type: 'hello.ok' });

    const result = await new Promise<unknown>((resolve) => {
      ws.addEventListener('message', (ev) => resolve(JSON.parse(String(ev.data))), { once: true });
      ws.send(
        JSON.stringify({
          type: 'invoke',
          id: '1',
          method: 'session.list',
          params: {},
        }),
      );
    });
    expect(result).toMatchObject({
      type: 'result',
      id: '1',
      result: { ok: true, data: [{ id: 's1' }] },
    });
    expect(invoke).toHaveBeenCalledWith({ method: 'session.list', params: {} });

    ws.close();
    await testHost.stop();
    expect(testHost.getStatus(true).running).toBe(false);
  }, 15_000);

  it('rejects a bad pairing code', async () => {
    const port = 19_000 + Math.floor(Math.random() * 1000);
    const host = new AgentHostServer({
      port,
      pairingCode: '111111',
      invoke: async () => ({ ok: true, data: null }),
    });
    await host.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('ws open failed')));
    });

    const reply = await new Promise<unknown>((resolve) => {
      ws.addEventListener('message', (ev) => resolve(JSON.parse(String(ev.data))), { once: true });
      ws.send(JSON.stringify({ type: 'hello', pairingCode: '000000' }));
    });
    expect(reply).toMatchObject({
      type: 'hello.err',
      error: { code: 'BAD_PAIRING_CODE' },
    });

    await host.stop();
  }, 15_000);
});
