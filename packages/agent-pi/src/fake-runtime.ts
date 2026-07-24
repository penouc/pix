import { randomUUID } from 'node:crypto';

import type {
  AgentEventListener,
  AgentInput,
  AgentRuntime,
  AgentSession,
  CreateSessionOptions,
} from '@pi-desktop/agent-domain';
import { DomainError, agentError } from '@pi-desktop/agent-domain';
import type { ApprovalDecision, DesktopAgentEvent, ModelRef, RunRef } from '@pi-desktop/protocol';

interface SessionRecord extends AgentSession {
  projectPath: string;
  model?: ModelRef;
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
    if (!input.text.trim()) {
      throw new DomainError(agentError('EMPTY_INPUT', 'Message text must not be empty'));
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
      },
      {
        providerId: 'fake',
        modelId: 'fake-fast',
        displayName: 'Fake Fast Model',
        hasAuth: true,
      },
    ];
  }

  async getAuthStatus() {
    return [{ providerId: 'fake', hasAuth: true, source: 'runtime' }];
  }

  async pickDefaultModel() {
    return { providerId: 'fake', modelId: 'fake-demo' };
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
