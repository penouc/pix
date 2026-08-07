import { describe, expect, it } from 'vitest';

import {
  extractUsage,
  parseSessionLogLines,
  readSessionLogMeta,
  sessionLogRunId,
} from './session-usage.js';

describe('session-usage', () => {
  it('extractUsage reads Pi assistant usage blocks', () => {
    expect(
      extractUsage({
        input: 100,
        output: 50,
        cost: { total: 0.0123 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      totalTokens: 150,
      costUsd: 0.0123,
    });
  });

  it('extractUsage includes cacheRead/cacheWrite in totalTokens', () => {
    expect(
      extractUsage({
        input: 100,
        output: 20,
        cacheRead: 8000,
        cacheWrite: 200,
        totalTokens: 8320,
        cost: { total: 0.05 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 8000,
      cacheWriteTokens: 200,
      totalTokens: 8320,
      costUsd: 0.05,
    });
  });

  it('parseSessionLogLines imports assistant turns with stable run ids', () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 'sess-1', cwd: '/tmp/proj' }),
      JSON.stringify({
        type: 'message',
        id: 'msg-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          provider: 'anthropic',
          model: 'claude-opus-5',
          timestamp: 1_700_000_000_000,
          usage: { input: 10, output: 20, cost: { total: 0.01 } },
        },
      }),
    ];

    const entries = parseSessionLogLines(lines, { sessionId: 'sess-1', cwd: '/tmp/proj' }, () => 'p1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      runId: sessionLogRunId('msg-1'),
      sessionId: 'sess-1',
      projectId: 'p1',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    });
  });

  it('readSessionLogMeta reads the session header', () => {
    expect(
      readSessionLogMeta([
        JSON.stringify({ type: 'session', id: 'sess-2', cwd: '/Users/pen/dev/pix' }),
      ]),
    ).toEqual({ sessionId: 'sess-2', cwd: '/Users/pen/dev/pix' });
  });
});
