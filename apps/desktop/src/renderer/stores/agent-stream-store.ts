import type { DesktopAgentEvent } from '@pi-desktop/protocol';
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  streaming: boolean;
}

export interface ToolCallCard {
  id: string;
  toolName: string;
  inputSummary: string;
  outputSummary?: string;
  ok?: boolean;
  status: 'running' | 'completed' | 'failed';
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

interface AgentStreamState {
  activeRunId: string | null;
  activeProjectId: string | null;
  activeSessionId: string | null;
  status:
    | 'idle'
    | 'starting'
    | 'running'
    | 'waiting_for_approval'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'cancelled';
  messages: ChatMessage[];
  tools: ToolCallCard[];
  usage: RunUsage | null;
  error: string | null;
  lastSequenceByRun: Record<string, number>;
  appendUserMessage: (text: string) => void;
  resetSessionView: () => void;
  setScope: (projectId: string | null, sessionId: string | null) => void;
  applyEvent: (event: DesktopAgentEvent) => void;
  setStopping: (runId: string) => void;
}

function shouldAccept(
  state: Pick<
    AgentStreamState,
    'lastSequenceByRun' | 'activeRunId' | 'activeProjectId' | 'activeSessionId'
  >,
  event: DesktopAgentEvent,
): boolean {
  // Scope filter (plan §8): only current project/session; allow new run.started anytime.
  if (state.activeProjectId && event.projectId !== state.activeProjectId) return false;
  if (state.activeSessionId && event.sessionId !== state.activeSessionId) return false;
  if (
    state.activeRunId &&
    event.runId !== state.activeRunId &&
    event.type !== 'run.started'
  ) {
    return false;
  }
  const last = state.lastSequenceByRun[event.runId] ?? -1;
  return event.sequence > last;
}

export const useAgentStreamStore = create<AgentStreamState>((set, get) => ({
  activeRunId: null,
  activeProjectId: null,
  activeSessionId: null,
  status: 'idle',
  messages: [],
  tools: [],
  usage: null,
  error: null,
  lastSequenceByRun: {},

  appendUserMessage: (text) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          streaming: false,
        },
      ],
    }));
  },

  resetSessionView: () => {
    set({
      activeRunId: null,
      status: 'idle',
      messages: [],
      tools: [],
      usage: null,
      error: null,
      lastSequenceByRun: {},
    });
  },

  setScope: (projectId, sessionId) => {
    set({ activeProjectId: projectId, activeSessionId: sessionId });
  },

  setStopping: (runId) => {
    set({ status: 'stopping', activeRunId: runId });
  },

  applyEvent: (event) => {
    const state = get();
    if (!shouldAccept(state, event)) {
      return;
    }

    const lastSequenceByRun = {
      ...state.lastSequenceByRun,
      [event.runId]: event.sequence,
    };

    switch (event.type) {
      case 'run.started':
        set({
          activeRunId: event.runId,
          activeProjectId: event.projectId,
          activeSessionId: event.sessionId,
          status: 'running',
          tools: [],
          usage: null,
          error: null,
          lastSequenceByRun,
        });
        break;
      case 'run.completed':
        set({
          status: 'completed',
          activeRunId: event.runId,
          lastSequenceByRun,
          messages: state.messages.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          ),
        });
        break;
      case 'run.failed':
        set({
          status: 'failed',
          activeRunId: event.runId,
          error: event.error.message,
          lastSequenceByRun,
        });
        break;
      case 'run.cancelled':
        set({
          status: 'cancelled',
          activeRunId: event.runId,
          lastSequenceByRun,
          messages: state.messages.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          ),
        });
        break;
      case 'message.delta': {
        const existing = state.messages.find((m) => m.id === event.messageId);
        if (existing) {
          set({
            lastSequenceByRun,
            messages: state.messages.map((m) =>
              m.id === event.messageId
                ? { ...m, content: m.content + event.delta, streaming: true }
                : m,
            ),
          });
        } else {
          set({
            lastSequenceByRun,
            messages: [
              ...state.messages,
              {
                id: event.messageId,
                role: event.role,
                content: event.delta,
                streaming: true,
              },
            ],
          });
        }
        break;
      }
      case 'message.completed': {
        const existing = state.messages.find((m) => m.id === event.messageId);
        if (existing) {
          set({
            lastSequenceByRun,
            messages: state.messages.map((m) =>
              m.id === event.messageId
                ? { ...m, content: event.content, streaming: false, role: event.role }
                : m,
            ),
          });
        } else {
          set({
            lastSequenceByRun,
            messages: [
              ...state.messages,
              {
                id: event.messageId,
                role: event.role,
                content: event.content,
                streaming: false,
              },
            ],
          });
        }
        break;
      }
      case 'tool.requested':
        set({
          lastSequenceByRun,
          tools: [
            ...state.tools,
            {
              id: event.toolCallId,
              toolName: event.toolName,
              inputSummary: event.inputSummary,
              status: 'running',
            },
          ],
        });
        break;
      case 'tool.completed':
        set({
          lastSequenceByRun,
          tools: state.tools.map((t) =>
            t.id === event.toolCallId
              ? {
                  ...t,
                  status: event.ok ? 'completed' : 'failed',
                  ok: event.ok,
                  outputSummary: event.outputSummary,
                }
              : t,
          ),
        });
        break;
      case 'tool.progress':
        set({ lastSequenceByRun });
        break;
      case 'approval.requested':
        set({
          status: 'waiting_for_approval',
          activeRunId: event.runId,
          lastSequenceByRun,
        });
        break;
      case 'approval.resolved':
        set({
          status: 'running',
          lastSequenceByRun,
        });
        break;
      case 'usage.updated':
        set({
          lastSequenceByRun,
          usage: {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            costUsd: event.costUsd,
          },
        });
        break;
      case 'files.changed':
        set({ lastSequenceByRun });
        break;
      default:
        set({ lastSequenceByRun });
    }
  },
}));
