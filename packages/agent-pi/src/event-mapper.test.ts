import { describe, expect, it } from 'vitest';

import { extractTextContent, mapPiSessionEvent, type MapContext } from './event-mapper.js';
import { extractUsage } from './session-usage.js';

function makeCtx(): MapContext & { seq: number; messageId: string | null } {
  const state = { seq: 0, messageId: null as string | null };
  return {
    projectId: 'p1',
    sessionId: 's1',
    runId: 'r1',
    seq: 0,
    messageId: null,
    nextSequence: () => {
      state.seq += 1;
      return state.seq;
    },
    ensureMessageId: () => {
      state.messageId ??= 'msg-1';
      return state.messageId;
    },
    clearMessageId: () => {
      state.messageId = null;
    },
  };
}

describe('mapPiSessionEvent', () => {
  it('skips agent_start (desktop emits run.started itself)', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent({ type: 'agent_start' }, ctx);
    expect(events).toEqual([]);
  });

  it('maps text_delta to message.delta', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      },
      ctx,
    );
    expect(events[0]).toMatchObject({
      type: 'message.delta',
      delta: 'Hello',
      role: 'assistant',
      messageId: 'msg-1',
    });
  });

  it('maps thinking_delta to thinking.delta', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Planning the fix' },
      },
      ctx,
    );
    expect(events[0]).toMatchObject({
      type: 'thinking.delta',
      delta: 'Planning the fix',
      messageId: 'msg-1',
    });
  });

  it('maps thinking_end to thinking.completed', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_end', content: 'Done planning.' },
      },
      ctx,
    );
    expect(events[0]).toMatchObject({
      type: 'thinking.completed',
      content: 'Done planning.',
      messageId: 'msg-1',
    });
  });

  it('maps tool_execution_start with risk', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'ls' },
      },
      ctx,
    );
    expect(events[0]).toMatchObject({
      type: 'tool.requested',
      toolName: 'bash',
      riskLevel: 'sensitive',
      inputSummary: 'bash: ls',
    });
  });

  it('maps message_end usage to usage.updated', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input: 120,
            output: 45,
            totalTokens: 165,
            cost: { total: 0.0024 },
          },
        },
      },
      ctx,
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('message.completed');
    expect(events[1]).toMatchObject({
      type: 'usage.updated',
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      costUsd: 0.0024,
    });
  });

  it('maps agent_end to run.completed', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent({ type: 'agent_end', messages: [] }, ctx);
    expect(events[0]?.type).toBe('run.completed');
  });

  it('ignores unknown events', () => {
    const ctx = makeCtx();
    expect(mapPiSessionEvent({ type: 'queue_update' }, ctx)).toEqual([]);
  });
});

describe('extractUsage', () => {
  it('reads Pi assistant usage envelope', () => {
    expect(
      extractUsage({
        input: 10,
        output: 20,
        totalTokens: 30,
        cost: { total: 0.01 },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.01,
    });
  });
});

describe('extractTextContent', () => {
  it('joins text blocks', () => {
    expect(
      extractTextContent([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
  });
});
