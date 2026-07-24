import { describe, expect, it } from 'vitest';

import { extractTextContent, mapPiSessionEvent, type MapContext } from './event-mapper.js';

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
  it('maps agent_start to run.started', () => {
    const ctx = makeCtx();
    const events = mapPiSessionEvent({ type: 'agent_start' }, ctx);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('run.started');
    expect(events[0]?.projectId).toBe('p1');
    expect(events[0]?.sequence).toBe(1);
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
