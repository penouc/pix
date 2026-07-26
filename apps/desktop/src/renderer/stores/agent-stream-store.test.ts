import type { DesktopAgentEvent } from '@pi-desktop/protocol';
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
});
