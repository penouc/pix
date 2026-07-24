import type { AgentError } from '@pi-desktop/protocol';

/** Agent run state machine (plan §8). */
export type AgentRunState =
  | { status: 'idle' }
  | { status: 'starting'; runId: string }
  | { status: 'running'; runId: string }
  | { status: 'waiting_for_approval'; runId: string; requestId: string }
  | { status: 'stopping'; runId: string }
  | { status: 'completed'; runId: string }
  | { status: 'failed'; runId: string; error: AgentError }
  | { status: 'cancelled'; runId: string };

export type AgentRunStatus = AgentRunState['status'];

const TERMINAL: ReadonlySet<AgentRunStatus> = new Set(['idle', 'completed', 'failed', 'cancelled']);

export function isTerminal(state: AgentRunState): boolean {
  return TERMINAL.has(state.status);
}

export function isActive(state: AgentRunState): boolean {
  return (
    state.status === 'starting' ||
    state.status === 'running' ||
    state.status === 'waiting_for_approval' ||
    state.status === 'stopping'
  );
}

/**
 * Apply a high-level transition. Returns the next state or the current state
 * if the transition is illegal (deterministic, no throw).
 */
export function transitionRunState(
  current: AgentRunState,
  event:
    | { type: 'start'; runId: string }
    | { type: 'started'; runId: string }
    | { type: 'approval'; runId: string; requestId: string }
    | { type: 'resume'; runId: string }
    | { type: 'stop'; runId: string }
    | { type: 'complete'; runId: string }
    | { type: 'fail'; runId: string; error: AgentError }
    | { type: 'cancel'; runId: string }
    | { type: 'reset' },
): AgentRunState {
  switch (event.type) {
    case 'reset':
      return { status: 'idle' };
    case 'start':
      if (current.status === 'idle' || isTerminal(current)) {
        return { status: 'starting', runId: event.runId };
      }
      return current;
    case 'started':
      if (
        (current.status === 'starting' || current.status === 'running') &&
        current.runId === event.runId
      ) {
        return { status: 'running', runId: event.runId };
      }
      return current;
    case 'approval':
      if (current.status === 'running' && current.runId === event.runId) {
        return {
          status: 'waiting_for_approval',
          runId: event.runId,
          requestId: event.requestId,
        };
      }
      return current;
    case 'resume':
      if (current.status === 'waiting_for_approval' && current.runId === event.runId) {
        return { status: 'running', runId: event.runId };
      }
      return current;
    case 'stop':
      if (isActive(current) && 'runId' in current && current.runId === event.runId) {
        return { status: 'stopping', runId: event.runId };
      }
      return current;
    case 'complete':
      if (isActive(current) && 'runId' in current && current.runId === event.runId) {
        return { status: 'completed', runId: event.runId };
      }
      return current;
    case 'fail':
      if (isActive(current) && 'runId' in current && current.runId === event.runId) {
        return { status: 'failed', runId: event.runId, error: event.error };
      }
      return current;
    case 'cancel':
      if (
        (current.status === 'stopping' || isActive(current)) &&
        'runId' in current &&
        current.runId === event.runId
      ) {
        return { status: 'cancelled', runId: event.runId };
      }
      return current;
    default:
      return current;
  }
}
