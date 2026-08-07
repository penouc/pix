import type { DesktopAgentEvent, StoredMessage } from '@pi-desktop/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { computeTokenRate, useAgentStreamStore } from './agent-stream-store';

function approvalEvent(overrides: Partial<DesktopAgentEvent> = {}): DesktopAgentEvent {
  return {
    type: 'approval.requested',
    projectId: 'p1',
    sessionId: 'terminal-session',
    runId: 'terminal-123',
    sequence: 1,
    timestamp: Date.now(),
    requestId: 'req-1',
    toolName: 'bash',
    summary: 'pnpm vitest run',
    command: 'pnpm vitest run',
    affectedPaths: [],
    riskLevel: 'elevated',
    reasons: ['spawns a process'],
    rememberable: true,
    ...overrides,
  } as DesktopAgentEvent;
}

describe('agent stream scoping', () => {
  beforeEach(() => {
    useAgentStreamStore.getState().resetSessionView();
    useAgentStreamStore.getState().setScope('p1', 'agent-session');
    useAgentStreamStore.setState({ activeRunId: 'agent-run-1' });
  });

  it('accepts an approval raised outside the active session and run', () => {
    // Regression: the Terminal panel raises approvals under its own session and
    // run id. Scoping them out left the command waiting on a decision the user
    // was never shown.
    useAgentStreamStore.getState().applyEvent(approvalEvent());
    expect(useAgentStreamStore.getState().approval?.requestId).toBe('req-1');
    expect(useAgentStreamStore.getState().status).toBe('waiting_for_approval');
  });

  it('still drops events from another project', () => {
    useAgentStreamStore.getState().applyEvent(approvalEvent({ projectId: 'other' }));
    expect(useAgentStreamStore.getState().approval).toBeNull();
  });

  it('rejects run events while the blank task screen has no session', () => {
    useAgentStreamStore.getState().resetSessionView();
    useAgentStreamStore.getState().setScope('p1', null);
    useAgentStreamStore.getState().applyEvent({
      type: 'message.completed',
      projectId: 'p1',
      sessionId: 'task-we-left',
      runId: 'old-run',
      sequence: 1,
      timestamp: Date.now(),
      messageId: 'old-message',
      role: 'assistant',
      content: 'This must not leak into the next task.',
    } as DesktopAgentEvent);
    expect(useAgentStreamStore.getState().messages).toHaveLength(0);
  });

  it('still scopes non-approval events to the active session', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'tool.requested',
      projectId: 'p1',
      sessionId: 'someone-else',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
      toolCallId: 't1',
      toolName: 'bash',
      inputSummary: 'echo hi',
    } as DesktopAgentEvent);
    expect(useAgentStreamStore.getState().tools).toHaveLength(0);
  });

  it('keeps prior tool cards when a new run starts', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'tool.requested',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
      toolCallId: 't1',
      toolName: 'read',
      inputSummary: 'README.md',
    } as DesktopAgentEvent);

    useAgentStreamStore.getState().applyEvent({
      type: 'run.started',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-2',
      sequence: 1,
      timestamp: Date.now(),
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().tools).toHaveLength(1);
    expect(useAgentStreamStore.getState().tools[0]?.toolName).toBe('read');
  });

  it('captures a Plan Mode draft for Approve → Build and clears it on reset', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'run.completed',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
      summary: 'plan run finished',
      planText: '1. read auth\n2. propose a fix',
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().pendingPlan).toMatchObject({
      text: '1. read auth\n2. propose a fix',
      runId: 'agent-run-1',
      sessionId: 'agent-session',
    });

    // A build-mode completion (no planText) must not wipe a prior plan.
    useAgentStreamStore.getState().applyEvent({
      type: 'run.completed',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-2',
      sequence: 3,
      timestamp: Date.now(),
    } as DesktopAgentEvent);
    expect(useAgentStreamStore.getState().pendingPlan).not.toBeNull();

    useAgentStreamStore.getState().resetSessionView();
    expect(useAgentStreamStore.getState().pendingPlan).toBeNull();
  });

  it('updates the active model when Auto routing switches mid-run', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'run.started',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 1,
      timestamp: Date.now(),
      model: { providerId: 'openai', modelId: 'gpt-4o-mini' },
    } as DesktopAgentEvent);

    useAgentStreamStore.getState().applyEvent({
      type: 'model.auto-switched',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
      from: { providerId: 'openai', modelId: 'gpt-4o-mini' },
      to: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      reason: 'rate-limit',
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().model).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    expect(useAgentStreamStore.getState().status).toBe('running');
    // The switch is visible in the thread as a system note.
    expect(useAgentStreamStore.getState().messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('keeps queued messages when the current run is cancelled', () => {
    useAgentStreamStore.getState().addQueuedMessage('continue with the tests');
    useAgentStreamStore.getState().applyEvent({
      type: 'run.cancelled',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().queuedMessages.map((item) => item.text)).toEqual([
      'continue with the tests',
    ]);
  });

  it('tracks latest-call context separately from accumulated run usage', () => {
    for (const [sequence, inputTokens, outputTokens] of [
      [2, 1_000, 100],
      [3, 1_500, 200],
    ] as const) {
      useAgentStreamStore.getState().applyEvent({
        type: 'usage.updated',
        projectId: 'p1',
        sessionId: 'agent-session',
        runId: 'agent-run-1',
        sequence,
        timestamp: Date.now(),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      } as DesktopAgentEvent);
    }

    expect(useAgentStreamStore.getState().usage).toMatchObject({
      inputTokens: 2_500,
      outputTokens: 300,
      totalTokens: 2_800,
      contextTokens: 1_700,
    });

    useAgentStreamStore.getState().setScope('p1', 'another-task');
    useAgentStreamStore.getState().setScope('p1', 'agent-session');
    expect(useAgentStreamStore.getState().usage?.contextTokens).toBe(1_700);
  });

  it('prefers context.updated occupancy over billing totals and tracks compacting', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'context.updated',
      projectId: 'p1',
      sessionId: 'agent-session',
      timestamp: Date.now(),
      tokens: 42_000,
      contextWindow: 200_000,
      percent: 21,
    });
    expect(useAgentStreamStore.getState().usage).toMatchObject({
      contextTokens: 42_000,
      contextWindow: 200_000,
      contextPercent: 21,
    });

    useAgentStreamStore.getState().applyEvent({
      type: 'compaction.started',
      projectId: 'p1',
      sessionId: 'agent-session',
      timestamp: Date.now(),
      reason: 'auto',
    });
    expect(useAgentStreamStore.getState().isCompacting).toBe(true);

    useAgentStreamStore.getState().applyEvent({
      type: 'compaction.completed',
      projectId: 'p1',
      sessionId: 'agent-session',
      timestamp: Date.now(),
      aborted: false,
      reason: 'auto',
    });
    expect(useAgentStreamStore.getState().isCompacting).toBe(false);
  });

  it('keeps a turn interactive while assistant content is streaming', () => {
    useAgentStreamStore.setState({ status: 'completed' });
    useAgentStreamStore.getState().applyEvent({
      type: 'message.delta',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 4,
      timestamp: Date.now(),
      messageId: 'streaming-message',
      role: 'assistant',
      delta: 'still writing',
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().status).toBe('running');
  });
});

describe('loadHistory timeline restore', () => {
  beforeEach(() => {
    useAgentStreamStore.getState().resetSessionView();
  });

  it('restores thinking and tool cards from structured transcript entries', () => {
    const history: StoredMessage[] = [
      { kind: 'message', role: 'user', text: 'fix the bug' },
      { kind: 'thinking', id: 'th1', content: 'Need to inspect App.tsx' },
      {
        kind: 'tool',
        id: 'tool1',
        toolName: 'read',
        inputSummary: 'read: App.tsx',
        outputSummary: 'export function App()',
        ok: true,
        status: 'completed',
      },
      { kind: 'message', role: 'assistant', text: 'Fixed.' },
    ];

    useAgentStreamStore.getState().loadHistory(history);
    const state = useAgentStreamStore.getState();

    expect(state.messages.map((m) => m.content)).toEqual(['fix the bug', 'Fixed.']);
    expect(state.thinkings).toEqual([
      expect.objectContaining({ id: 'think-th1', content: 'Need to inspect App.tsx', streaming: false }),
    ]);
    expect(state.tools).toEqual([
      expect.objectContaining({
        id: 'tool1',
        toolName: 'read',
        inputSummary: 'read: App.tsx',
        outputSummary: 'export function App()',
        status: 'completed',
        ok: true,
      }),
    ]);
    // Arrival order is preserved across kinds.
    expect(state.thinkings[0]!.order).toBeLessThan(state.tools[0]!.order);
    expect(state.tools[0]!.order).toBeLessThan(state.messages[1]!.order);
  });
});

describe('thinking / message id namespace', () => {
  beforeEach(() => {
    useAgentStreamStore.getState().resetSessionView();
    useAgentStreamStore.getState().setScope('p1', 'agent-session');
    useAgentStreamStore.setState({ activeRunId: 'agent-run-1' });
  });

  it('keeps thinking cards distinct from assistant messages that share messageId', () => {
    // Pi maps thinking + assistant text onto one ensureMessageId() value.
    const sharedId = '1de04618-0d6d-4260-91bc-92d41fef1eba';
    useAgentStreamStore.getState().applyEvent({
      type: 'thinking.completed',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 1,
      timestamp: Date.now(),
      messageId: sharedId,
      content: 'plan the fix',
    } as DesktopAgentEvent);
    useAgentStreamStore.getState().applyEvent({
      type: 'message.completed',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: Date.now(),
      messageId: sharedId,
      role: 'assistant',
      content: 'Done.',
    } as DesktopAgentEvent);

    const state = useAgentStreamStore.getState();
    expect(state.messages.map((m) => m.id)).toEqual([sharedId]);
    expect(state.thinkings.map((t) => t.id)).toEqual([`think-${sharedId}`]);
  });
});

describe('token rate sampling', () => {
  beforeEach(() => {
    useAgentStreamStore.getState().resetSessionView();
    useAgentStreamStore.getState().setScope('p1', 'agent-session');
    useAgentStreamStore.setState({ activeRunId: 'agent-run-1' });
  });

  it('computes tokens per second over the trailing window', () => {
    const t0 = Date.now();
    const samples = [
      { timestamp: t0, inputTokens: 1_000, outputTokens: 500 },
      { timestamp: t0 + 5_000, inputTokens: 2_000, outputTokens: 1_000 },
    ];
    const rate = computeTokenRate(samples, t0 + 10_000);
    expect(rate).not.toBeNull();
    expect(rate!.inputPerSec).toBeCloseTo(300, 0); // 3000 / 10s
    expect(rate!.outputPerSec).toBeCloseTo(150, 0); // 1500 / 10s
    expect(rate!.totalPerSec).toBeCloseTo(450, 0);
  });

  it('returns null once every sample ages out of the window', () => {
    const t0 = Date.now();
    const samples = [{ timestamp: t0, inputTokens: 100, outputTokens: 50 }];
    expect(computeTokenRate(samples, t0 + 11_000)).toBeNull();
  });

  it('records usage.updated deltas as samples and resets them on a new run', () => {
    useAgentStreamStore.getState().applyEvent({
      type: 'usage.updated',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 2,
      timestamp: 1_000,
      inputTokens: 400,
      outputTokens: 100,
    } as DesktopAgentEvent);
    useAgentStreamStore.getState().applyEvent({
      type: 'usage.updated',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-1',
      sequence: 3,
      timestamp: 2_000,
      inputTokens: 600,
      outputTokens: 200,
    } as DesktopAgentEvent);

    expect(useAgentStreamStore.getState().tokenRateSamples).toEqual([
      { timestamp: 1_000, inputTokens: 400, outputTokens: 100 },
      { timestamp: 2_000, inputTokens: 600, outputTokens: 200 },
    ]);

    // A fresh run must not inherit the previous run's rate samples.
    useAgentStreamStore.getState().applyEvent({
      type: 'run.started',
      projectId: 'p1',
      sessionId: 'agent-session',
      runId: 'agent-run-2',
      sequence: 4,
      timestamp: 3_000,
    } as DesktopAgentEvent);
    expect(useAgentStreamStore.getState().tokenRateSamples).toEqual([]);
  });
});
