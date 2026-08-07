import type { DesktopAgentEvent, InputImage, RiskLevel, StoredMessage } from '@pi-desktop/protocol';
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  images?: Array<{ name: string; mimeType: string; size: number; data?: string }>;
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

export interface ThinkingCard {
  id: string;
  content: string;
  streaming: boolean;
  order: number;
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Tokens in the latest model call, used for context-window occupancy. */
  contextTokens?: number;
  /** From context.updated when available — preferred over model-catalogue capacity. */
  contextWindow?: number;
  contextPercent?: number;
  costUsd?: number;
}

/** One usage.updated delta, timestamped so a sliding window can estimate live rate. */
export interface TokenRateSample {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
}

/** How far back the live token-rate window looks. */
export const TOKEN_RATE_WINDOW_MS = 10_000;

/**
 * Tokens per second over the trailing window. Returns null once every sample
 * has aged out, so the UI can stop showing a number while a run sits idle.
 */
export function computeTokenRate(
  samples: readonly TokenRateSample[],
  now = Date.now(),
): { inputPerSec: number; outputPerSec: number; totalPerSec: number } | null {
  const cutoff = now - TOKEN_RATE_WINDOW_MS;
  let input = 0;
  let output = 0;
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;
  for (const sample of samples) {
    if (sample.timestamp < cutoff) continue;
    input += sample.inputTokens;
    output += sample.outputTokens;
    if (sample.timestamp < oldest) oldest = sample.timestamp;
    if (sample.timestamp > newest) newest = sample.timestamp;
  }
  if (newest === 0 || (input === 0 && output === 0)) return null;
  // Measure the window from the oldest sample to *now*: as samples age out
  // without fresh usage, the rate decays smoothly toward zero instead of
  // freezing on the last burst.
  const elapsedSeconds = Math.max(now - oldest, 1_000) / 1_000;
  return {
    inputPerSec: input / elapsedSeconds,
    outputPerSec: output / elapsedSeconds,
    totalPerSec: (input + output) / elapsedSeconds,
  };
}

/** Keep the sample ring small: a minute of history is plenty for a 10s window. */
function pruneTokenRateSamples(
  samples: TokenRateSample[],
  now: number,
): TokenRateSample[] {
  const cutoff = now - 60_000;
  const pruned = samples.filter((sample) => sample.timestamp >= cutoff);
  return pruned.length > 200 ? pruned.slice(-200) : pruned;
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

export interface QueuedMessage {
  id: string;
  text: string;
  images?: InputImage[];
  mode: 'queue' | 'steer';
  createdAt: number;
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
  thinkings: ThinkingCard[];
  usage: RunUsage | null;
  /** Timestamped usage deltas for the live token-rate readout (event-driven). */
  tokenRateSamples: TokenRateSample[];
  /** Last reported context occupancy per task, persisted across restarts. */
  contextTokensBySession: Record<string, number>;
  /** Context window size from the latest context.updated (preferred over model catalogue). */
  contextWindowBySession: Record<string, number>;
  /** True while Pi is compacting the active session. */
  isCompacting: boolean;
  /**
   * Auto-retry in flight (#8): Pi is retrying the current model call after a
   * transient provider/transport failure. Non-null only while a retry is
   * scheduled; the UI shows the attempt instead of looking frozen.
   */
  retry: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage?: string;
  } | null;
  model: { providerId: string; modelId: string } | null;
  startedAt: number | null;
  /**
   * Draft captured from a Plan-mode run (#3). Non-null until the user
   * approves (→ inject as first message of a Build run) or discards it.
   */
  pendingPlan: { text: string; runId: string; sessionId: string } | null;
  lastUserText: string | null;
  lastUserImages: InputImage[];
  errorRetryable: boolean;
  approval: ApprovalRequest | null;
  error: string | null;
  lastSequenceByRun: Record<string, number>;
  queuedMessages: QueuedMessage[];
  addQueuedMessage: (
    text: string,
    mode?: 'queue' | 'steer',
    images?: InputImage[],
  ) => QueuedMessage;
  removeQueuedMessage: (id: string) => void;
  updateQueuedMessage: (id: string, text: string) => void;
  clearQueue: () => void;
  popNextQueuedMessage: () => QueuedMessage | undefined;
  appendUserMessage: (text: string, images?: InputImage[]) => void;
  resetSessionView: () => void;
  /** Replace the thread with a stored transcript (oldest first). */
  loadHistory: (messages: StoredMessage[]) => void;
  setScope: (projectId: string | null, sessionId: string | null) => void;
  applyEvent: (event: DesktopAgentEvent) => void;
  setStopping: (runId: string) => void;
}

function shouldAccept(
  state: Pick<
    AgentStreamState,
    'lastSequenceByRun' | 'activeRunId' | 'activeProjectId' | 'activeSessionId'
  >,
  event: Exclude<
    DesktopAgentEvent,
    { type: 'session.updated' } | { type: 'context.updated' } | { type: 'compaction.started' } | { type: 'compaction.completed' }
  >,
): boolean {
  if (state.activeProjectId && event.projectId !== state.activeProjectId) return false;

  // Approvals block whoever raised them — an agent run OR a user command in the
  // Terminal panel, which carries its own runId. Dropping one leaves the caller
  // waiting forever, so they are exempt from run/session scoping.
  const isApproval = event.type === 'approval.requested' || event.type === 'approval.resolved';

  if (!isApproval) {
    // A null session means the blank “New task” screen, not “accept every
    // session”. Treating it as a wildcard let a run from the task we just left
    // repopulate the cleared timeline and made its messages appear in the next
    // task while that task was being created.
    if (!state.activeSessionId || event.sessionId !== state.activeSessionId) {
      return false;
    }
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

const CONTEXT_USAGE_STORAGE_KEY = 'pix:context-usage-by-session';

function readPersistedContextUsage(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTEXT_USAGE_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0,
      ),
    );
  } catch {
    return {};
  }
}

function persistContextUsage(value: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CONTEXT_USAGE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode / a full storage quota must not break the chat stream.
  }
}

/** Monotonic arrival counter shared by messages and tool cards. */
let timelineSeq = 0;
const nextOrder = () => (timelineSeq += 1);

/**
 * Thinking and assistant text share one `messageId` in the live Pi stream
 * (`ensureMessageId`). Namespace thinking cards so the timeline never emits
 * two React children with the same key.
 */
function toThinkingId(messageId: string): string {
  return messageId.startsWith('think-') ? messageId : `think-${messageId}`;
}

function autoSwitchMessage(
  event: Extract<DesktopAgentEvent, { type: 'model.auto-switched' }>,
): string {
  const reasonLabel: Record<string, string> = {
    'rate-limit': 'rate limited',
    timeout: 'timed out',
    quota: 'hit its quota',
    error: 'errored',
  };
  return `${event.from.modelId} ${reasonLabel[event.reason] ?? 'failed'} — Auto switched to ${event.to.modelId} and retried this turn.`;
}

/** Pending message.delta chunks coalesced per animation frame (plan §14.1). */
const pendingDeltas = new Map<string, { role: ChatMessage['role']; chunks: string[] }>();
const pendingThinkingDeltas = new Map<string, string[]>();
let deltaFlushHandle: number | null = null;
let lastSequenceByRunBuffer: Record<string, number> = {};

function scheduleDeltaFlush(
  get: () => AgentStreamState,
  set: (
    partial: Partial<AgentStreamState> | ((state: AgentStreamState) => Partial<AgentStreamState>),
  ) => void,
) {
  if (deltaFlushHandle != null) return;
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;

  deltaFlushHandle = raf(() => {
    deltaFlushHandle = null;
    if (pendingDeltas.size === 0 && pendingThinkingDeltas.size === 0) return;

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

    let thinkings = state.thinkings;
    for (const [messageId, chunks] of pendingThinkingDeltas) {
      const delta = chunks.join('');
      chunks.length = 0;
      if (!delta) continue;
      const thinkingId = toThinkingId(messageId);
      const existing = thinkings.find((t) => t.id === thinkingId);
      if (existing) {
        thinkings = thinkings.map((t) =>
          t.id === thinkingId ? { ...t, content: t.content + delta, streaming: true } : t,
        );
      } else {
        thinkings = [
          ...thinkings,
          {
            id: thinkingId,
            content: delta,
            streaming: true,
            order: nextOrder(),
          },
        ];
      }
    }
    pendingThinkingDeltas.clear();

    set({
      messages,
      thinkings,
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
  pendingThinkingDeltas.clear();
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
  thinkings: [],
  usage: null,
  tokenRateSamples: [],
  contextTokensBySession: readPersistedContextUsage(),
  contextWindowBySession: {},
  isCompacting: false,
  retry: null,
  model: null,
  startedAt: null,
  pendingPlan: null,
  lastUserText: null,
  lastUserImages: [],
  errorRetryable: false,
  approval: null,
  error: null,
  lastSequenceByRun: {},
  queuedMessages: [],

  addQueuedMessage: (text, mode = 'queue', images) => {
    const msg: QueuedMessage = {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      ...(images?.length ? { images } : {}),
      mode,
      createdAt: Date.now(),
    };
    set((state) => ({ queuedMessages: [...state.queuedMessages, msg] }));
    return msg;
  },

  removeQueuedMessage: (id) => {
    set((state) => ({ queuedMessages: state.queuedMessages.filter((m) => m.id !== id) }));
  },

  updateQueuedMessage: (id, text) => {
    set((state) => ({
      queuedMessages: state.queuedMessages.map((m) =>
        m.id === id ? { ...m, text: text.trim() } : m,
      ),
    }));
  },

  clearQueue: () => set({ queuedMessages: [] }),

  popNextQueuedMessage: () => {
    const list = get().queuedMessages;
    if (!list.length) return undefined;
    const [next, ...rest] = list;
    set({ queuedMessages: rest });
    return next;
  },

  appendUserMessage: (text, images) => {
    set((state) => ({
      lastUserText: text,
      lastUserImages: images ?? [],
      messages: [
        ...state.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          ...(images?.length ? { images } : {}),
          streaming: false,
          order: nextOrder(),
        },
      ],
    }));
  },

  loadHistory: (history) => {
    clearDeltaBatch();
    const messages: ChatMessage[] = [];
    const thinkings: ThinkingCard[] = [];
    const tools: ToolCallCard[] = [];
    let orderSeq = 0;

    for (let index = 0; index < history.length; index++) {
      const entry = history[index]!;

      if (entry.kind === 'thinking') {
        const content = entry.content.trim();
        if (!content) continue;
        thinkings.push({
          id: entry.id ? toThinkingId(entry.id) : `history-think-${index}`,
          content,
          streaming: false,
          order: orderSeq++,
        });
        continue;
      }

      if (entry.kind === 'tool') {
        tools.push({
          id: entry.id || `history-tool-${index}`,
          toolName: entry.toolName,
          inputSummary: entry.inputSummary,
          outputSummary: entry.outputSummary,
          ok: entry.ok,
          status: entry.status === 'running' ? 'completed' : entry.status,
          order: orderSeq++,
        });
        continue;
      }

      // kind === 'message' (and legacy { role, text } without kind via normalize)
      const role = entry.role;
      let text = entry.text;

      if (role === 'assistant') {
        // Legacy transcripts sometimes embedded tags in assistant prose.
        const thinkRegex = /<(?:think|thinking)>([\s\S]*?)(?:<\/(?:think|thinking)>|$)/gi;
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        let cleanContent = '';
        let extractedThinking = '';

        while ((match = thinkRegex.exec(text)) !== null) {
          cleanContent += text.slice(lastIndex, match.index);
          extractedThinking += (extractedThinking ? '\n\n' : '') + match[1]!.trim();
          lastIndex = thinkRegex.lastIndex;
        }
        cleanContent += text.slice(lastIndex);
        text = cleanContent;

        if (extractedThinking.trim()) {
          thinkings.push({
            id: `history-think-${index}`,
            content: extractedThinking.trim(),
            streaming: false,
            order: orderSeq++,
          });
        }

        const toolRegex = /<(?:tool_call|tool)[\s\S]*?>([\s\S]*?)(?:<\/(?:tool_call|tool)>|$)/gi;
        let toolMatch: RegExpExecArray | null;
        let toolLastIndex = 0;
        let textAfterTools = '';

        while ((toolMatch = toolRegex.exec(text)) !== null) {
          textAfterTools += text.slice(toolLastIndex, toolMatch.index);
          const toolRaw = toolMatch[1]!.trim();
          try {
            const parsed = JSON.parse(toolRaw);
            tools.push({
              id: `history-tool-${index}-${orderSeq}`,
              toolName: parsed.name || parsed.tool || 'tool',
              inputSummary:
                typeof parsed.arguments === 'object'
                  ? JSON.stringify(parsed.arguments, null, 2)
                  : String(parsed.arguments || toolRaw),
              status: 'completed',
              order: orderSeq++,
            });
          } catch {
            tools.push({
              id: `history-tool-${index}-${orderSeq}`,
              toolName: 'tool',
              inputSummary: toolRaw,
              status: 'completed',
              order: orderSeq++,
            });
          }
          toolLastIndex = toolRegex.lastIndex;
        }
        textAfterTools += text.slice(toolLastIndex);

        messages.push({
          id: `history-${index}`,
          role,
          content: textAfterTools.trim() || text.trim() || entry.text,
          streaming: false,
          order: orderSeq++,
        });
      } else {
        messages.push({
          id: `history-${index}`,
          role,
          content: entry.text,
          ...(entry.images?.length ? { images: entry.images } : {}),
          streaming: false,
          order: orderSeq++,
        });
      }
    }

    timelineSeq = orderSeq;
    set({
      messages,
      tools,
      thinkings,
      status: 'idle',
      activeRunId: null,
      pendingPlan: null,
      usage: get().activeSessionId
        ? { contextTokens: get().contextTokensBySession[get().activeSessionId!] }
        : null,
      tokenRateSamples: [],
      error: null,
      errorRetryable: false,
      queuedMessages: [],
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
      thinkings: [],
      usage: null,
      tokenRateSamples: [],
      model: null,
      startedAt: null,
      pendingPlan: null,
      lastUserText: null,
      lastUserImages: [],
      errorRetryable: false,
      approval: null,
      error: null,
      lastSequenceByRun: {},
      queuedMessages: [],
      isCompacting: false,
      retry: null,
    });
  },

  setScope: (projectId, sessionId) => {
    const remembered = sessionId ? get().contextTokensBySession[sessionId] : undefined;
    const rememberedWindow = sessionId ? get().contextWindowBySession[sessionId] : undefined;
    set({
      activeProjectId: projectId,
      activeSessionId: sessionId,
      usage:
        remembered == null
          ? null
          : {
              contextTokens: remembered,
              ...(rememberedWindow != null ? { contextWindow: rememberedWindow } : {}),
            },
      tokenRateSamples: [],
      queuedMessages: [],
      isCompacting: false,
    });
  },

  setStopping: (runId) => {
    set({ status: 'stopping', activeRunId: runId });
  },

  applyEvent: (event) => {
    // Metadata / session-scoped events — not run-sequence gated.
    if (event.type === 'session.updated') return;

    if (event.type === 'context.updated') {
      const state = get();
      if (state.activeSessionId && event.sessionId !== state.activeSessionId) return;
      if (state.activeProjectId && event.projectId !== state.activeProjectId) return;
      const contextTokensBySession =
        event.tokens == null
          ? state.contextTokensBySession
          : {
              ...state.contextTokensBySession,
              [event.sessionId]: event.tokens,
            };
      if (event.tokens != null) persistContextUsage(contextTokensBySession);
      set({
        contextTokensBySession,
        contextWindowBySession: {
          ...state.contextWindowBySession,
          [event.sessionId]: event.contextWindow,
        },
        usage: {
          ...state.usage,
          contextTokens: event.tokens ?? state.usage?.contextTokens,
          contextWindow: event.contextWindow,
          contextPercent: event.percent ?? undefined,
        },
      });
      return;
    }

    if (event.type === 'compaction.started') {
      const state = get();
      if (state.activeSessionId && event.sessionId !== state.activeSessionId) return;
      set({ isCompacting: true });
      return;
    }

    if (event.type === 'compaction.completed') {
      const state = get();
      if (state.activeSessionId && event.sessionId !== state.activeSessionId) return;
      set({ isCompacting: false });
      return;
    }

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
          retry: null,
          // Keep prior tool cards in the thread — clearing them made follow-up
          // runs look like the agent never used any tools. Keep the last known
          // context value visible until this run reports a fresher one.
          usage:
            state.contextTokensBySession[event.sessionId] == null
              ? null
              : { contextTokens: state.contextTokensBySession[event.sessionId] },
          tokenRateSamples: [],
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
          retry: null,
          lastSequenceByRun,
          // Plan Mode (#3): hold the draft until the user approves or
          // discards it; build-mode completions leave a prior plan alone.
          pendingPlan: event.planText
            ? { text: event.planText, runId: event.runId, sessionId: event.sessionId }
            : state.pendingPlan,
          messages: get().messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          thinkings: get().thinkings.map((t) => (t.streaming ? { ...t, streaming: false } : t)),
        });
        break;
      case 'run.failed':
        clearDeltaBatch();
        set({
          status: 'failed',
          activeRunId: event.runId,
          retry: null,
          approval: null,
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
          retry: null,
          approval: null,
          lastSequenceByRun,
          messages: get().messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          thinkings: get().thinkings.map((t) => (t.streaming ? { ...t, streaming: false } : t)),
        });
        break;
      case 'model.auto-switched':
        // Auto routing (#21) retried the same turn on the next model in the
        // chain. Keep the run alive, update the active model, and leave a
        // visible system note in the thread.
        set({
          status: 'running',
          lastSequenceByRun,
          model: { providerId: event.to.providerId, modelId: event.to.modelId },
          messages: [
            ...get().messages,
            {
              id: `auto-switch-${event.runId}-${event.sequence}`,
              role: 'system',
              content: autoSwitchMessage(event),
              streaming: false,
              order: nextOrder(),
            },
          ],
        });
        break;
      case 'run.retry-started':
        // The run keeps going; only the attempt badge changes.
        set({
          status: state.status === 'stopping' ? 'stopping' : 'running',
          retry: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
          },
          lastSequenceByRun,
        });
        break;
      case 'run.retry-finished':
        set({ retry: null, lastSequenceByRun });
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
        // Still advance sequence bookkeeping immediately so late/dupe events
        // drop. A visible content delta also keeps the turn interactive even if
        // a provider reported its terminal state slightly early.
        set({ lastSequenceByRun, status: state.status === 'stopping' ? 'stopping' : 'running' });
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
      case 'thinking.delta': {
        const pending = pendingThinkingDeltas.get(event.messageId) ?? [];
        pending.push(event.delta);
        pendingThinkingDeltas.set(event.messageId, pending);
        lastSequenceByRunBuffer[event.runId] = event.sequence;
        set({ lastSequenceByRun, status: state.status === 'stopping' ? 'stopping' : 'running' });
        scheduleDeltaFlush(get, set);
        break;
      }
      case 'thinking.completed': {
        const buffered = pendingThinkingDeltas.get(event.messageId)?.join('') ?? '';
        pendingThinkingDeltas.delete(event.messageId);
        const thinkingId = toThinkingId(event.messageId);
        const current = get().thinkings.find((t) => t.id === thinkingId);
        const content = event.content || (current ? current.content + buffered : buffered);
        const existing = get().thinkings.find((t) => t.id === thinkingId);
        if (existing) {
          set({
            lastSequenceByRun,
            thinkings: get().thinkings.map((t) =>
              t.id === thinkingId ? { ...t, content, streaming: false } : t,
            ),
          });
        } else if (content) {
          set({
            lastSequenceByRun,
            thinkings: [
              ...get().thinkings,
              {
                id: thinkingId,
                content,
                streaming: false,
                order: nextOrder(),
              },
            ],
          });
        } else {
          set({ lastSequenceByRun });
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
        set((state) => {
          const prev = state.usage;
          // Feed the live token-rate window with this delta. Coalescing happens
          // on the same 10s window the readout shows, so the number stays
          // smooth rather than spiking per chunk.
          const tokenRateSamples =
            event.inputTokens != null || event.outputTokens != null
              ? pruneTokenRateSamples(
                  [
                    ...state.tokenRateSamples,
                    {
                      timestamp: event.timestamp,
                      inputTokens: event.inputTokens ?? 0,
                      outputTokens: event.outputTokens ?? 0,
                    },
                  ],
                  event.timestamp,
                )
              : state.tokenRateSamples;
          const inputTokens =
            event.inputTokens != null
              ? (prev?.inputTokens ?? 0) + event.inputTokens
              : prev?.inputTokens;
          const outputTokens =
            event.outputTokens != null
              ? (prev?.outputTokens ?? 0) + event.outputTokens
              : prev?.outputTokens;
          const costUsd =
            event.costUsd != null ? (prev?.costUsd ?? 0) + event.costUsd : prev?.costUsd;
          const totalTokens =
            inputTokens != null && outputTokens != null
              ? inputTokens + outputTokens
              : (event.totalTokens ?? prev?.totalTokens);
          // Billing totals accumulate across tool/model turns, but context
          // occupancy is the latest call only. Summing every turn can report
          // more than 100% even though each individual prompt fits.
          const contextTokens =
            event.totalTokens ??
            (event.inputTokens != null || event.outputTokens != null
              ? (event.inputTokens ?? 0) + (event.outputTokens ?? 0)
              : prev?.contextTokens);
          const contextTokensBySession =
            contextTokens == null
              ? state.contextTokensBySession
              : {
                  ...state.contextTokensBySession,
                  [event.sessionId]: contextTokens,
                };
          if (contextTokens != null) persistContextUsage(contextTokensBySession);
          return {
            lastSequenceByRun,
            contextTokensBySession,
            tokenRateSamples,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens,
              contextTokens,
              costUsd,
            },
          };
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
