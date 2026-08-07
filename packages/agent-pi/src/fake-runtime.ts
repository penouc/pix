import { randomUUID } from 'node:crypto';

import type {
  AgentEventListener,
  AgentInput,
  AgentRuntime,
  AgentSession,
  CreateSessionOptions,
} from '@pi-desktop/agent-domain';
import { DomainError, agentError } from '@pi-desktop/agent-domain';
import type {
  ApprovalDecision,
  CompactionResult,
  ContextUsage,
  DesktopAgentEvent,
  ModelRef,
  RunRef,
  ThinkingLevel,
  ThinkingLevelState,
  SessionMode,
} from '@pi-desktop/protocol';

import { deriveSessionTitle, sanitizeSessionTitle } from './session-title.js';

const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

interface SessionRecord extends AgentSession {
  projectPath: string;
  model?: ModelRef;
  thinkingLevel: ThinkingLevel;
  /** First user prompt — used for offline auto-naming. */
  firstUserText?: string;
  lastAssistantText?: string;
  contextTokens: number;
  autoCompactionEnabled: boolean;
  sessionMode: SessionMode;
}

interface ActiveRun {
  runId: string;
  sessionId: string;
  projectId: string;
  aborted: boolean;
  timers: NodeJS.Timeout[];
}

const DEMO_REPLY =
  'I am the FakeAgentRuntime used for offline development and E2E tests.\n\n' +
  'In a later milestone this adapter will forward work to the Pi Agent SDK. ' +
  'For now I simulate streaming text, a read tool call, and a completed run.';

/**
 * Deterministic runtime for UI development without model cost (plan §7.1).
 */
export class FakeAgentRuntime implements AgentRuntime {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly runs = new Map<string, ActiveRun>();
  private readonly listeners = new Set<AgentEventListener>();
  private disposed = false;

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    this.assertAlive();
    const now = Date.now();
    const session: SessionRecord = {
      id: options.id ?? randomUUID(),
      projectId: options.projectId,
      projectPath: options.projectPath,
      title: options.title ?? 'New session',
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
      model: options.model,
      thinkingLevel: 'medium',
      contextTokens: 12_000,
      autoCompactionEnabled: true,
      sessionMode: 'build',
    };
    this.sessions.set(session.id, session);
    return this.toPublic(session);
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    return this.toPublic(session);
  }

  async sendMessage(sessionId: string, input: AgentInput): Promise<RunRef> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    if (!input.text.trim() && !input.images?.length) {
      throw new DomainError(agentError('EMPTY_INPUT', 'A message needs text or an image'));
    }

    const runId = randomUUID();
    const active: ActiveRun = {
      runId,
      sessionId,
      projectId: session.projectId,
      aborted: false,
      timers: [],
    };
    this.runs.set(runId, active);
    session.updatedAt = Date.now();
    if (input.model) session.model = input.model;
    session.firstUserText ??= input.text.trim();

    void this.simulateRun(active, session, input.text);
    return { runId, sessionId };
  }

  async steer(runId: string, _input: AgentInput): Promise<void> {
    this.assertAlive();
    if (!this.runs.has(runId)) {
      throw new DomainError(agentError('RUN_NOT_FOUND', `Run ${runId} not found`));
    }
  }

  async followUp(sessionId: string, input: AgentInput): Promise<void> {
    await this.sendMessage(sessionId, input);
  }

  async abort(runId: string): Promise<void> {
    this.assertAlive();
    const run = this.runs.get(runId);
    if (!run) return;
    run.aborted = true;
    for (const timer of run.timers) clearTimeout(timer);
    run.timers = [];
    this.emit({
      type: 'run.cancelled',
      projectId: run.projectId,
      sessionId: run.sessionId,
      runId,
      sequence: this.nextSeq(run),
      timestamp: Date.now(),
    });
    this.runs.delete(runId);
  }

  async setModel(sessionId: string, model: ModelRef): Promise<void> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    session.model = model;
    session.updatedAt = Date.now();
  }

  async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    session.thinkingLevel = level;
    session.updatedAt = Date.now();
  }

  async getThinkingLevel(sessionId: string): Promise<ThinkingLevelState> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    return {
      level: session.thinkingLevel,
      available: ALL_THINKING_LEVELS,
      supportsThinking: true,
    };
  }

  async getContextUsage(sessionId: string): Promise<ContextUsage | null> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    const contextWindow = 128_000;
    return {
      tokens: session.contextTokens,
      contextWindow,
      percent: Math.min(100, Math.round((session.contextTokens / contextWindow) * 100)),
    };
  }

  async compact(sessionId: string, _customInstructions?: string): Promise<CompactionResult> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    const tokensBefore = session.contextTokens;
    this.emit({
      type: 'compaction.started',
      projectId: session.projectId,
      sessionId: session.id,
      timestamp: Date.now(),
      reason: 'manual',
    });
    session.contextTokens = Math.max(2_000, Math.floor(session.contextTokens * 0.35));
    const result: CompactionResult = {
      summary: 'Fake compaction kept the recent turns and dropped older tool noise.',
      tokensBefore,
      estimatedTokensAfter: session.contextTokens,
    };
    this.emit({
      type: 'compaction.completed',
      projectId: session.projectId,
      sessionId: session.id,
      timestamp: Date.now(),
      aborted: false,
      reason: 'manual',
      summary: result.summary,
      tokensBefore,
      estimatedTokensAfter: session.contextTokens,
    });
    this.emit({
      type: 'context.updated',
      projectId: session.projectId,
      sessionId: session.id,
      timestamp: Date.now(),
      tokens: session.contextTokens,
      contextWindow: 128_000,
      percent: Math.min(100, Math.round((session.contextTokens / 128_000) * 100)),
    });
    session.updatedAt = Date.now();
    return result;
  }

  async setAutoCompactionEnabled(enabled: boolean, sessionId?: string): Promise<void> {
    this.assertAlive();
    if (!sessionId) {
      for (const session of this.sessions.values()) {
        session.autoCompactionEnabled = enabled;
      }
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    session.autoCompactionEnabled = enabled;
  }

  async getAutoCompactionEnabled(sessionId?: string): Promise<boolean> {
    this.assertAlive();
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
      }
      return session.autoCompactionEnabled;
    }
    return true;
  }

  async abortCompaction(sessionId: string): Promise<void> {
    this.assertAlive();
    if (!this.sessions.has(sessionId)) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
  }

  private approvalMode: 'ask' | 'auto-reads' | 'read-only' = 'auto-reads';

  async setApprovalMode(
    mode: 'ask' | 'auto-reads' | 'read-only',
    _sessionId?: string,
  ): Promise<void> {
    this.approvalMode = mode;
  }

  async getApprovalMode(): Promise<'ask' | 'auto-reads' | 'read-only'> {
    return this.approvalMode;
  }

  private sessionMode: SessionMode = 'build';

  async setSessionMode(mode: SessionMode, sessionId?: string): Promise<void> {
    this.assertAlive();
    this.sessionMode = mode;
    if (!sessionId) {
      for (const session of this.sessions.values()) {
        session.sessionMode = mode;
      }
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      // No live runtime session yet — keep as default for the next create.
      return;
    }
    session.sessionMode = mode;
  }

  async getSessionMode(sessionId?: string): Promise<SessionMode> {
    this.assertAlive();
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      return session?.sessionMode ?? this.sessionMode;
    }
    return this.sessionMode;
  }

  async listRememberedDecisions(): Promise<[]> {
    return [];
  }

  async clearRememberedDecisions(): Promise<number> {
    return 0;
  }

  async configureProvider(_providerId: string, _apiKey: string): Promise<void> {
    this.assertAlive();
  }

  async removeProviderConfiguration(_providerId: string): Promise<void> {
    this.assertAlive();
  }

  async approve(_requestId: string, _decision: ApprovalDecision): Promise<void> {
    this.assertAlive();
    // Fake runtime does not pause for approvals yet.
  }

  async listModels() {
    return [
      {
        providerId: 'fake',
        modelId: 'fake-demo',
        displayName: 'Fake Demo Model',
        hasAuth: true,
        supportsImages: true,
      },
      {
        providerId: 'fake',
        modelId: 'fake-fast',
        displayName: 'Fake Fast Model',
        hasAuth: true,
        supportsImages: true,
      },
    ];
  }

  async getAuthStatus() {
    return [{ providerId: 'fake', hasAuth: true, source: 'runtime' }];
  }

  async pickDefaultModel() {
    return { providerId: 'fake', modelId: 'fake-demo' };
  }

  /** Offline stand-in: same heuristic Main falls back to when the model fails. */
  async generateSessionTitle(sessionId: string): Promise<string | null> {
    this.assertAlive();
    const session = this.sessions.get(sessionId);
    if (!session?.firstUserText) return null;
    return sanitizeSessionTitle(deriveSessionTitle(session.firstUserText));
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    for (const run of this.runs.values()) {
      for (const timer of run.timers) clearTimeout(timer);
    }
    this.runs.clear();
    this.listeners.clear();
    this.disposed = true;
  }

  private async simulateRun(
    run: ActiveRun,
    session: SessionRecord,
    userText: string,
  ): Promise<void> {
    let sequence = 0;
    const next = () => {
      sequence += 1;
      return sequence;
    };
    // stash for abort path
    (run as ActiveRun & { _seq?: number })._seq = sequence;
    const bump = () => {
      sequence += 1;
      (run as ActiveRun & { _seq?: number })._seq = sequence;
      return sequence;
    };

    this.emit({
      type: 'run.started',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      model: session.model ?? { providerId: 'fake', modelId: 'fake-demo' },
    });

    if (run.aborted) return;

    const toolCallId = randomUUID();
    await this.delay(run, 80);
    if (run.aborted) return;

    this.emit({
      type: 'tool.requested',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      toolCallId,
      toolName: 'read',
      inputSummary: `path: ${session.projectPath}/README.md`,
      riskLevel: 'safe',
    });

    await this.delay(run, 120);
    if (run.aborted) return;

    this.emit({
      type: 'tool.completed',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      toolCallId,
      toolName: 'read',
      ok: true,
      outputSummary: 'README.md (simulated)',
    });

    const messageId = randomUUID();
    const reply = `${DEMO_REPLY}\n\nYou said: "${userText.trim()}"`;
    session.lastAssistantText = reply;
    const chunks = chunkText(reply, 24);

    for (const delta of chunks) {
      await this.delay(run, 35);
      if (run.aborted) return;
      this.emit({
        type: 'message.delta',
        projectId: session.projectId,
        sessionId: session.id,
        runId: run.runId,
        sequence: bump(),
        timestamp: Date.now(),
        messageId,
        role: 'assistant',
        delta,
      });
    }

    if (run.aborted) return;

    this.emit({
      type: 'message.completed',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      messageId,
      role: 'assistant',
      content: reply,
    });

    this.emit({
      type: 'usage.updated',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      inputTokens: Math.ceil(userText.length / 4),
      outputTokens: Math.ceil(reply.length / 4),
      totalTokens: Math.ceil((userText.length + reply.length) / 4),
      costUsd: 0,
    });

    this.emit({
      type: 'run.completed',
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.runId,
      sequence: bump(),
      timestamp: Date.now(),
      summary: 'Fake run completed',
    });

    this.runs.delete(run.runId);
    void next;
  }

  private nextSeq(run: ActiveRun): number {
    const extended = run as ActiveRun & { _seq?: number };
    extended._seq = (extended._seq ?? 0) + 1;
    return extended._seq;
  }

  private delay(run: ActiveRun, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        run.timers = run.timers.filter((t) => t !== timer);
        resolve();
      }, ms);
      run.timers.push(timer);
    });
  }

  private emit(event: DesktopAgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[FakeAgentRuntime] listener error', error);
      }
    }
  }

  private toPublic(session: SessionRecord): AgentSession {
    return {
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new DomainError(agentError('RUNTIME_DISPOSED', 'AgentRuntime has been disposed'));
    }
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [''];
}
