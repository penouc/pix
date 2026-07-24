import { describe, expect, it } from 'vitest';

import { isActive, isTerminal, transitionRunState, type AgentRunState } from './state.js';

describe('transitionRunState', () => {
  it('moves idle -> starting -> running -> completed', () => {
    let state: AgentRunState = { status: 'idle' };
    state = transitionRunState(state, { type: 'start', runId: 'r1' });
    expect(state).toEqual({ status: 'starting', runId: 'r1' });
    state = transitionRunState(state, { type: 'started', runId: 'r1' });
    expect(state).toEqual({ status: 'running', runId: 'r1' });
    state = transitionRunState(state, { type: 'complete', runId: 'r1' });
    expect(state).toEqual({ status: 'completed', runId: 'r1' });
    expect(isTerminal(state)).toBe(true);
  });

  it('ignores mismatched runId', () => {
    const running: AgentRunState = { status: 'running', runId: 'r1' };
    const next = transitionRunState(running, { type: 'complete', runId: 'other' });
    expect(next).toEqual(running);
  });

  it('supports approval pause and resume', () => {
    let state: AgentRunState = { status: 'running', runId: 'r1' };
    state = transitionRunState(state, { type: 'approval', runId: 'r1', requestId: 'a1' });
    expect(state).toEqual({
      status: 'waiting_for_approval',
      runId: 'r1',
      requestId: 'a1',
    });
    expect(isActive(state)).toBe(true);
    state = transitionRunState(state, { type: 'resume', runId: 'r1' });
    expect(state).toEqual({ status: 'running', runId: 'r1' });
  });
});
