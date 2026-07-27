import type { DesktopAgentEvent, RiskLevel } from '@pi-desktop/protocol';
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  streaming: boolean;
  /** Arrival order, shared with tool cards so the thread can interleave them. */
  order: number;
}

export interface ToolCallCard {
  id: string;
  toolName: string;
  inputSummary: string;
  outputSummary?: string;
  ok?: boolean;
  status: 'running' | 'completed' | 'failed';
  /** Arrival order, shared with messages so the thread can interleave them. */
  order: number;
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  summary: string;
  command?: string;
  affectedPaths: string[];
  riskLevel: RiskLevel;
  reasons: string[];
  rememberable: boolean;
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
  model: { providerId: string; modelId: string } | null;
  startedAt: number | null;
  lastUserText: string | null;
  errorRetryable: boolean;
  approval: ApprovalRequest | null;
  error: string | null;
  lastSequenceByRun: Record<string, number>;
  appendUserMessage: (text: string) => void;
  resetSessionView: () => void;
  /** Replace the thread with a stored transcript (oldest first). */
  loadHistory: (messages: Array<{ role: 'user' | 'assistant' | 'system'; text: string }>) => void;
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
  if (state.activeProjectId && event.projectId !== state.activeProjectId) return false;

  // Approvals block whoever raised them — an agent run OR a user command in the
  // Terminal panel, which carries its own runId. Dropping one leaves the caller
  // waiting forever, so they are exempt from run/session scoping.
  const isApproval = event.type === 'approval.requested' || event.type === 'approval.resolved';

  if (!isApproval && state.activeSessionId && event.sessionId !== state.activeSessionId) {
    return false;
  }
  if (
    !isApproval &&
    state.activeRunId &&
    event.runId !== state.activeRunId &&
    event.type !== 'run.started'
  ) {
    return false;
  }
  const last = state.lastSequenceByRun[event.runId] ?? -1;
  return event.sequence > last;
}

/** Monotonic arrival counter shared by messages and tool cards. */
let timelineSeq = 0;
const nextOrder = () => (timelineSeq += 1);

/** Pending message.delta chunks coalesced per animation frame (plan §14.1). */
const pendingDeltas = new Map<string, { role: ChatMessage['role']; chunks: string[] }>();
let deltaFlushHandle: number | null = null;
let lastSequenceByRunBuffer: Record<string, number> = {};

function scheduleDeltaFlush(
  get: () => AgentStreamState,
  set: (partial: Partial<AgentStreamState>) => void,
) {
  if (deltaFlushHandle != null) return;
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;

  deltaFlushHandle = raf(() => {
    deltaFlushHandle = null;
    if (pendingDeltas.size === 0) return;

    const state = get();
    let messages = state.messages;
    for (const [messageId, pending] of pendingDeltas) {
      const delta = pending.chunks.join('');
      pending.chunks = [];
      if (!delta) continue;
      const existing = messages.find((m) => m.id === messageId);
      if (existing) {
        messages = messages.map((m) =>
          m.id === messageId
            ? { ...m, content: m.content + delta, streaming: true, role: pending.role }
            : m,
        );
      } else {
        messages = [
          ...messages,
          {
            id: messageId,
            role: pending.role,
            content: delta,
            streaming: true,
            order: nextOrder(),
          },
        ];
      }
    }
    pendingDeltas.clear();
    set({
      messages,
      lastSequenceByRun: {
        ...state.lastSequenceByRun,
        ...lastSequenceByRunBuffer,
      },
    });
    lastSequenceByRunBuffer = {};
  }) as unknown as number;
}

function clearDeltaBatch() {
  pendingDeltas.clear();
  lastSequenceByRunBuffer = {};
  if (deltaFlushHandle != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(deltaFlushHandle);
  }
  deltaFlushHandle = null;
}

export const useAgentStreamStore = create<AgentStreamState>((set, get) => ({
  activeRunId: null,
  activeProjectId: null,
  activeSessionId: null,
  status: 'idle',
  messages: [],
  tools: [],
  usage: null,
  model: null,
  startedAt: null,
  lastUserText: null,
  errorRetryable: false,
  approval: null,
  error: null,
  lastSequenceByRun: {},

  appendUserMessage: (text) => {
    set((state) => ({
      lastUserText: text,
      messages: [
        ...state.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          streaming: false,
          order: nextOrder(),
        },
      ],
    }));
  },

  loadHistory: (history) => {
    clearDeltaBatch();
    // Restored turns take the first slots in the shared ordering, so anything
    // that streams afterwards lands below them rather than above.
    timelineSeq = history.length;
    set({
      messages: history.map((entry, index) => ({
        id: `history-${index}`,
        role: entry.role,
        content: entry.text,
        streaming: false,
        order: index,
      })),
      tools: [],
      status: 'idle',
      activeRunId: null,
      error: null,
      errorRetryable: false,
    });
  },
  resetSessionView: () => {
    clearDeltaBatch();
    timelineSeq = 0;
    set({
      activeRunId: null,
      status: 'idle',
      messages: [],
      tools: [],
      usage: null,
      model: null,
      startedAt: null,
      lastUserText: null,
      errorRetryable: false,
      approval: null,
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
        clearDeltaBatch();
        set({
          activeRunId: event.runId,
          activeProjectId: event.projectId,
          activeSessionId: event.sessionId,
          status: 'running',
          // Keep prior tool cards in the thread — clearing them made follow-up
          // runs look like the agent never used any tools.
          usage: null,
          model: event.model ?? null,
          startedAt: event.timestamp,
          approval: null,
          error: null,
          errorRetryable: false,
          lastSequenceByRun,
        });
        break;
      case 'run.completed':
        clearDeltaBatch();
        set({
          status: 'completed',
          activeRunId: event.runId,
          lastSequenceByRun,
          messages: get().messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        });
        break;
      case 'run.failed':
        clearDeltaBatch();
        set({
          status: 'failed',
          activeRunId: event.runId,
          error: event.error.message,
          errorRetryable: event.error.retryable,
          lastSequenceByRun,
        });
        break;
      case 'run.cancelled':
        clearDeltaBatch();
        set({
          status: 'cancelled',
          activeRunId: event.runId,
          lastSequenceByRun,
          messages: get().messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        });
        break;
      case 'message.delta': {
        // Coalesce high-frequency token deltas onto animation frames.
        const pending = pendingDeltas.get(event.messageId) ?? {
          role: event.role,
          chunks: [],
        };
        pending.role = event.role;
        pending.chunks.push(event.delta);
        pendingDeltas.set(event.messageId, pending);
        lastSequenceByRunBuffer[event.runId] = event.sequence;
        // Still advance sequence bookkeeping immediately so late/dupe events drop.
        set({ lastSequenceByRun });
        scheduleDeltaFlush(get, set);
        break;
      }
      case 'message.completed': {
        // Flush any pending deltas for this message first.
        const pending = pendingDeltas.get(event.messageId);
        if (pending) {
          pendingDeltas.delete(event.messageId);
        }
        const buffered = pending?.chunks.join('') ?? '';
        const current = get().messages.find((m) => m.id === event.messageId);
        const content = event.content || (current ? current.content + buffered : buffered);
        const existing = get().messages.find((m) => m.id === event.messageId);
        if (existing) {
          set({
            lastSequenceByRun,
            messages: get().messages.map((m) =>
              m.id === event.messageId ? { ...m, content, streaming: false, role: event.role } : m,
            ),
          });
        } else {
          set({
            lastSequenceByRun,
            messages: [
              ...get().messages,
              {
                id: event.messageId,
                role: event.role,
                content,
                streaming: false,
                order: nextOrder(),
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
              order: nextOrder(),
            },
          ],
        });
        break;
      case 'tool.completed':
        set({
          lastSequenceByRun,
          tools: get().tools.map((t) =>
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
          approval: {
            requestId: event.requestId,
            toolName: event.toolName,
            summary: event.summary,
            command: event.command,
            affectedPaths: event.affectedPaths,
            riskLevel: event.riskLevel,
            reasons: event.reasons,
            rememberable: event.rememberable,
          },
        });
        break;
      case 'approval.resolved':
        set({
          status: 'running',
          lastSequenceByRun,
          approval: null,
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
