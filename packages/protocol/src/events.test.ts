import { describe, expect, it } from 'vitest';

import { DesktopAgentEventSchema } from './events.js';
import { parseIpcCommand } from './ipc.js';

describe('DesktopAgentEventSchema', () => {
  it('accepts a well-formed message.delta', () => {
    const result = DesktopAgentEventSchema.safeParse({
      type: 'message.delta',
      projectId: 'p1',
      sessionId: 's1',
      runId: 'r1',
      sequence: 1,
      timestamp: Date.now(),
      messageId: 'm1',
      role: 'assistant',
      delta: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing scope fields', () => {
    const result = DesktopAgentEventSchema.safeParse({
      type: 'run.started',
      sequence: 0,
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });
});

describe('parseIpcCommand', () => {
  it('accepts agent.sendMessage', () => {
    const result = parseIpcCommand({
      method: 'agent.sendMessage',
      params: { sessionId: 's1', text: 'fix the button' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown methods', () => {
    const result = parseIpcCommand({ method: 'hack.execute', params: {} });
    expect(result.success).toBe(false);
  });
});
