import type { DesktopAgentEvent, StoredMessage } from '@pi-desktop/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStreamStore } from './agent-stream-store';

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
