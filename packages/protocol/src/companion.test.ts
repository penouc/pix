import { describe, expect, it } from 'vitest';

import {
  parseCompanionClientMessage,
  parseCompanionHostMessage,
  COMPANION_ALLOWED_METHODS,
} from './companion.js';

describe('companion wire protocol', () => {
  it('accepts hello and allowed invokes', () => {
    expect(
      parseCompanionClientMessage({
        type: 'hello',
        pairingCode: '123456',
        clientName: 'phone',
      }).success,
    ).toBe(true);
    expect(
      parseCompanionClientMessage({
        type: 'invoke',
        id: '1',
        method: 'session.list',
        params: {},
      }).success,
    ).toBe(true);
  });

  it('rejects desktop-only methods', () => {
    expect(
      parseCompanionClientMessage({
        type: 'invoke',
        id: '1',
        method: 'terminal.exec',
        params: { projectId: 'p', command: 'ls' },
      }).success,
    ).toBe(false);
  });

  it('parses host hello.ok and event envelopes', () => {
    expect(
      parseCompanionHostMessage({
        type: 'hello.ok',
        status: { port: 7847, urls: ['http://127.0.0.1:7847'] },
      }).success,
    ).toBe(true);
    expect(
      parseCompanionHostMessage({
        type: 'event',
        event: {
          type: 'run.started',
          projectId: 'p',
          sessionId: 's',
          runId: 'r',
          sequence: 0,
          timestamp: 1,
        },
      }).success,
    ).toBe(true);
  });

  it('keeps a focused allow-list for Phase 1', () => {
    expect(COMPANION_ALLOWED_METHODS).toContain('agent.resolveApproval');
    expect(COMPANION_ALLOWED_METHODS).not.toContain('terminal.exec');
  });
});
