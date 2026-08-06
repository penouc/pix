import type {
  ApprovalDecision,
  DesktopAgentEvent,
  RiskLevel,
  SessionSummary,
  StoredMessage,
} from '@pi-desktop/protocol';
import { create } from 'zustand';

import { companionClient } from '../lib/client';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  streaming: boolean;
  order: number;
}

export interface ToolCard {
  id: string;
  toolName: string;
  inputSummary: string;
  outputSummary?: string;
  ok?: boolean;
  status: 'running' | 'completed' | 'failed';
  order: number;
}

export interface ThinkingCard {
  id: string;
  content: string;
  streaming: boolean;
  order: number;
}

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  summary: string;
  command?: string;
  affectedPaths: string[];
  riskLevel: RiskLevel;
  reasons: string[];
}

export type ThreadItem =
  | { kind: 'message'; data: ChatMessage }
  | { kind: 'tool'; data: ToolCard }
  | { kind: 'thinking'; data: ThinkingCard };

interface CompanionState {
  connected: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  tools: ToolCard[];
  thinking: ThinkingCard[];
  approval: ApprovalRequest | null;
  status: 'idle' | 'running' | 'waiting_for_approval';
  error: string | null;
  nextOrder: number;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  loadSessions: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  clearSession: () => void;
  sendMessage: (text: string) => Promise<void>;
  resolveApproval: (decision: ApprovalDecision) => Promise<void>;
  applyEvent: (event: DesktopAgentEvent) => void;
  thread: () => ThreadItem[];
}

function fromStored(entries: StoredMessage[]): {
  messages: ChatMessage[];
  tools: ToolCard[];
  thinking: ThinkingCard[];
  nextOrder: number;
} {
  const messages: ChatMessage[] = [];
  const tools: ToolCard[] = [];
  const thinking: ThinkingCard[] = [];
  let order = 0;
  for (const entry of entries) {
    if (entry.kind === 'message') {
      messages.push({
        id: `stored-msg-${order}`,
        role: entry.role,
        content: entry.text,
        streaming: false,
        order: order++,
      });
    } else if (entry.kind === 'tool') {
      tools.push({
        id: entry.id,
        toolName: entry.toolName,
        inputSummary: entry.inputSummary,
        outputSummary: entry.outputSummary,
        ok: entry.ok,
        status: entry.status,
        order: order++,
      });
    } else {
      thinking.push({
        id: entry.id,
        content: entry.content,
        streaming: false,
        order: order++,
      });
    }
  }
  return { messages, tools, thinking, nextOrder: order };
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  connected: false,
  sessions: [],
  activeSessionId: null,
  messages: [],
  tools: [],
  thinking: [],
  approval: null,
  status: 'idle',
  error: null,
  nextOrder: 0,

  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),

  loadSessions: async () => {
    const sessions = await companionClient.invoke<SessionSummary[]>('session.list', {});
    set({ sessions });
  },

  openSession: async (sessionId) => {
    const entries = await companionClient.invoke<StoredMessage[]>('session.messages', { sessionId });
    const hydrated = fromStored(entries);
    set({
      activeSessionId: sessionId,
      ...hydrated,
      approval: null,
      status: 'idle',
      error: null,
    });
  },

  clearSession: () =>
    set({
      activeSessionId: null,
      messages: [],
      tools: [],
      thinking: [],
      approval: null,
      status: 'idle',
      nextOrder: 0,
    }),

  sendMessage: async (text) => {
    const sessionId = get().activeSessionId;
    if (!sessionId || !text.trim()) return;
    const wasRunning = get().status === 'running';
    const order = get().nextOrder;
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          content: text.trim(),
          streaming: false,
          order,
        },
      ],
      nextOrder: order + 1,
      status: 'running',
      error: null,
    }));
    try {
      if (wasRunning) {
        await companionClient.invoke('agent.followUp', { sessionId, text: text.trim() });
      } else {
        await companionClient.invoke('agent.sendMessage', { sessionId, text: text.trim() });
      }
    } catch (error) {
      if (wasRunning) {
        try {
          await companionClient.invoke('agent.sendMessage', { sessionId, text: text.trim() });
          return;
        } catch (inner) {
          set({
            error: inner instanceof Error ? inner.message : String(inner),
            status: 'idle',
          });
          return;
        }
      }
      set({
        error: error instanceof Error ? error.message : String(error),
        status: 'idle',
      });
    }
  },

  resolveApproval: async (decision) => {
    const approval = get().approval;
    if (!approval) return;
    await companionClient.invoke('agent.resolveApproval', {
      requestId: approval.requestId,
      decision,
    });
    set({ approval: null, status: decision === 'deny' ? 'idle' : 'running' });
  },

  applyEvent: (event) => {
    const sessionId = get().activeSessionId;
    if ('sessionId' in event && sessionId && event.sessionId !== sessionId) {
      // Still refresh session list titles / ordering for background activity.
      if (event.type === 'session.updated' || event.type === 'run.completed') {
        void get().loadSessions().catch(() => undefined);
      }
      return;
    }

    set((state) => reduceEvent(state, event));
  },

  thread: () => {
    const { messages, tools, thinking } = get();
    const items: ThreadItem[] = [
      ...messages.map((data) => ({ kind: 'message' as const, data })),
      ...tools.map((data) => ({ kind: 'tool' as const, data })),
      ...thinking.map((data) => ({ kind: 'thinking' as const, data })),
    ];
    return items.sort((a, b) => a.data.order - b.data.order);
  },
}));

function reduceEvent(state: CompanionState, event: DesktopAgentEvent): Partial<CompanionState> {
  let nextOrder = state.nextOrder;

  switch (event.type) {
    case 'run.started':
      return { status: 'running' };
    case 'run.completed':
    case 'run.cancelled':
      return { status: 'idle', approval: null };
    case 'run.failed':
      return {
        status: 'idle',
        error: event.error.message,
        approval: null,
      };
    case 'message.delta': {
      const existing = state.messages.find((m) => m.id === event.messageId);
      if (existing) {
        return {
          messages: state.messages.map((m) =>
            m.id === event.messageId
              ? { ...m, content: m.content + event.delta, streaming: true }
              : m,
          ),
        };
      }
      return {
        messages: [
          ...state.messages,
          {
            id: event.messageId,
            role: event.role,
            content: event.delta,
            streaming: true,
            order: nextOrder++,
          },
        ],
        nextOrder,
      };
    }
    case 'message.completed': {
      const existing = state.messages.find((m) => m.id === event.messageId);
      if (existing) {
        return {
          messages: state.messages.map((m) =>
            m.id === event.messageId
              ? { ...m, content: event.content, streaming: false, role: event.role }
              : m,
          ),
        };
      }
      return {
        messages: [
          ...state.messages,
          {
            id: event.messageId,
            role: event.role,
            content: event.content,
            streaming: false,
            order: nextOrder++,
          },
        ],
        nextOrder,
      };
    }
    case 'thinking.delta': {
      const existing = state.thinking.find((t) => t.id === event.messageId);
      if (existing) {
        return {
          thinking: state.thinking.map((t) =>
            t.id === event.messageId
              ? { ...t, content: t.content + event.delta, streaming: true }
              : t,
          ),
        };
      }
      return {
        thinking: [
          ...state.thinking,
          { id: event.messageId, content: event.delta, streaming: true, order: nextOrder++ },
        ],
        nextOrder,
      };
    }
    case 'thinking.completed': {
      const existing = state.thinking.find((t) => t.id === event.messageId);
      if (existing) {
        return {
          thinking: state.thinking.map((t) =>
            t.id === event.messageId ? { ...t, content: event.content, streaming: false } : t,
          ),
        };
      }
      return {
        thinking: [
          ...state.thinking,
          { id: event.messageId, content: event.content, streaming: false, order: nextOrder++ },
        ],
        nextOrder,
      };
    }
    case 'tool.requested':
      return {
        tools: [
          ...state.tools.filter((t) => t.id !== event.toolCallId),
          {
            id: event.toolCallId,
            toolName: event.toolName,
            inputSummary: event.inputSummary,
            status: 'running',
            order: nextOrder++,
          },
        ],
        nextOrder,
      };
    case 'tool.completed':
      return {
        tools: state.tools.map((t) =>
          t.id === event.toolCallId
            ? {
                ...t,
                toolName: event.toolName,
                outputSummary: event.outputSummary,
                ok: event.ok,
                status: event.ok ? 'completed' : 'failed',
              }
            : t,
        ),
      };
    case 'approval.requested':
      return {
        status: 'waiting_for_approval',
        approval: {
          requestId: event.requestId,
          toolName: event.toolName,
          summary: event.summary,
          command: event.command,
          affectedPaths: event.affectedPaths,
          riskLevel: event.riskLevel,
          reasons: event.reasons,
        },
      };
    case 'approval.resolved':
      return { approval: null, status: 'running' };
    case 'session.updated':
      return {
        sessions: state.sessions.map((s) =>
          s.id === event.sessionId ? { ...s, title: event.title, updatedAt: event.timestamp } : s,
        ),
      };
    default:
      return {};
  }
}
