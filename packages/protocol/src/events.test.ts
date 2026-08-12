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

  it('accepts run.completed with a Plan Mode draft', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'run.completed',
        projectId: 'p1',
        sessionId: 's1',
        runId: 'r1',
        sequence: 4,
        timestamp: Date.now(),
        summary: 'Pi agent run completed',
        planText: '1. read the auth module\n2. propose a fix',
      }).success,
    ).toBe(true);
  });

  it('accepts model.auto-switched with scope and reason', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'model.auto-switched',
        projectId: 'p1',
        sessionId: 's1',
        runId: 'r1',
        sequence: 3,
        timestamp: Date.now(),
        from: { providerId: 'openai', modelId: 'gpt-4o-mini' },
        to: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
        reason: 'rate-limit',
      }).success,
    ).toBe(true);
  });

  it('accepts run.retry-started and run.retry-finished', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'run.retry-started',
        projectId: 'p1',
        sessionId: 's1',
        runId: 'r1',
        sequence: 2,
        timestamp: Date.now(),
        attempt: 1,
        maxAttempts: 2,
        delayMs: 1500,
        errorMessage: '429 rate limited',
      }).success,
    ).toBe(true);
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'run.retry-finished',
        projectId: 'p1',
        sessionId: 's1',
        runId: 'r1',
        sequence: 3,
        timestamp: Date.now(),
        success: true,
        attempt: 1,
      }).success,
    ).toBe(true);
  });

  it('accepts session.updated without a run scope', () => {
    const result = DesktopAgentEventSchema.safeParse({
      type: 'session.updated',
      projectId: 'p1',
      sessionId: 's1',
      title: 'Fix login button',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts context.updated and compaction events without a run scope', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'context.updated',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        tokens: 40_000,
        contextWindow: 128_000,
        percent: 31,
      }).success,
    ).toBe(true);
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'compaction.started',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        reason: 'auto',
      }).success,
    ).toBe(true);
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'compaction.completed',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        aborted: false,
        reason: 'manual',
        summary: 'Kept recent turns',
        tokensBefore: 90_000,
        estimatedTokensAfter: 22_000,
      }).success,
    ).toBe(true);
  });
});

describe('parseIpcCommand', () => {
  it('accepts update.status with download progress', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'update.status',
        status: 'downloading',
        currentVersion: '0.2.2',
        version: '0.2.3',
        progress: 42,
        timestamp: Date.now(),
      }).success,
    ).toBe(true);
  });

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

describe('#11/#12 collaboration events', () => {
  it('accepts todo.updated with a checklist', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'todo.updated',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        items: [
          { id: 't1', text: 'Inspect the auth module', status: 'in_progress' },
          { id: 't2', text: 'Fix the token refresh', status: 'pending' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects todo items with an unknown status', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'todo.updated',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        items: [{ id: 't1', text: 'x', status: 'half-done' }],
      }).success,
    ).toBe(false);
  });

  it('accepts ask.pending with options and ask.resolved', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'ask.pending',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        askId: 'ask-1',
        question: 'Which approach should I take?',
        options: [{ id: 'fast', label: 'Fast & cheap' }],
        allowFreeText: true,
      }).success,
    ).toBe(true);
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'ask.resolved',
        projectId: 'p1',
        sessionId: 's1',
        timestamp: Date.now(),
        askId: 'ask-1',
        optionId: 'fast',
        answer: 'Fast & cheap',
      }).success,
    ).toBe(true);
  });

  it('accepts terminal.data and terminal.exit PTY events', () => {
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'terminal.data',
        projectId: 'p1',
        ptySessionId: 'pty-1',
        sequence: 1,
        timestamp: Date.now(),
        dataBase64: Buffer.from('hi').toString('base64'),
        data: 'hi',
      }).success,
    ).toBe(true);
    expect(
      DesktopAgentEventSchema.safeParse({
        type: 'terminal.exit',
        projectId: 'p1',
        ptySessionId: 'pty-1',
        sequence: 2,
        timestamp: Date.now(),
        exitCode: 0,
        signal: null,
      }).success,
    ).toBe(true);
  });
});
