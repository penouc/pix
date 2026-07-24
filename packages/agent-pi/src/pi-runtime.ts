import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession as PiAgentSession,
} from '@earendil-works/pi-coding-agent';
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
  DesktopAgentEvent,
  ModelRef,
  RunRef,
} from '@pi-desktop/protocol';

import {
  describeAuthSources,
  hydrateRuntimeAuthFromEnv,
  type ProviderAuthSummary,
} from './credentials.js';
import { mapPiSessionEvent, type PiSessionEventLike } from './event-mapper.js';

export interface PiAgentRuntimeOptions {
  /**
   * Directory for Pi-related local state (plan §7.2 controllable paths).
   * Defaults to `<firstProject>/.pi-desktop/agent`.
   */
  agentDir?: string;
  /** Allow ModelRuntime to refresh catalogs over the network. Default false. */
  allowModelNetwork?: boolean;
  /** Apply process.env API keys via setRuntimeApiKey. Default true. */
  hydrateEnvAuth?: boolean;
}

interface SessionRecord {
  desktop: AgentSession;
  projectPath: string;
  pi: PiAgentSession;
  unsubscribePi: () => void;
  sequence: number;
  activeRunId: string | null;
  abortedRunIds: Set<string>;
  currentMessageId: string | null;
}

/**
 * Real Pi SDK adapter (plan §7 / M1).
 * Pi types never leave this package.
 */
export class PiAgentRuntime implements AgentRuntime {
  private readonly listeners = new Set<AgentEventListener>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly runToSession = new Map<string, string>();
  private modelRuntime: ModelRuntime | null = null;
  private agentDir: string | null;
  private readonly allowModelNetwork: boolean;
  private readonly hydrateEnvAuth: boolean;
  private authSummaries: ProviderAuthSummary[] = [];
  private disposed = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: PiAgentRuntimeOptions = {}) {
    this.agentDir = options.agentDir ?? null;
    this.allowModelNetwork = options.allowModelNetwork ?? false;
    this.hydrateEnvAuth = options.hydrateEnvAuth ?? true;
  }

  /** Non-secret summary of which providers have credentials. */
  async getAuthStatus(): Promise<ProviderAuthSummary[]> {
    await this.ensureRuntime(process.cwd());
    return [...this.authSummaries];
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    this.assertAlive();
    await this.ensureRuntime(options.projectPath);

    const now = Date.now();
    const desktopId = randomUUID();

    let piSession: PiAgentSession;
    try {
      const result = await createAgentSession({
        cwd: options.projectPath,
        agentDir: this.agentDir!,
        modelRuntime: this.modelRuntime!,
        sessionManager: SessionManager.inMemory(),
      });
      piSession = result.session;
    } catch (error) {
      throw new DomainError(
        agentError(
          'PI_SESSION_CREATE_FAILED',
          error instanceof Error ? error.message : String(error),
          { details: error },
        ),
      );
    }

    if (options.model) {
      try {
        await this.applyModel(piSession, options.model);
      } catch {
        // Model may be unavailable without auth; session still creatable.
      }
    }

    const desktop: AgentSession = {
      id: desktopId,
      projectId: options.projectId,
      title: options.title ?? (path.basename(options.projectPath) || 'Session'),
      createdAt: now,
      updatedAt: now,
    };

    const record: SessionRecord = {
      desktop,
      projectPath: options.projectPath,
      pi: piSession,
      unsubscribePi: () => undefined,
      sequence: 0,
      activeRunId: null,
      abortedRunIds: new Set(),
      currentMessageId: null,
    };

    record.unsubscribePi = piSession.subscribe((event) => {
      this.onPiEvent(record, event as PiSessionEventLike);
    });

    this.sessions.set(desktopId, record);
    return { ...desktop };
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    return { ...record.desktop };
  }

  async sendMessage(sessionId: string, input: AgentInput): Promise<RunRef> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    if (!input.text.trim()) {
      throw new DomainError(agentError('EMPTY_INPUT', 'Message text must not be empty'));
    }
    if (record.pi.isStreaming) {
      throw new DomainError(
        agentError('RUN_IN_PROGRESS', 'A run is already active; use follow-up or abort first'),
      );
    }

    if (input.model) {
      await this.applyModel(record.pi, input.model);
    }

    const runId = randomUUID();
    record.activeRunId = runId;
    record.sequence = 0;
    record.currentMessageId = null;
    this.runToSession.set(runId, sessionId);
    record.desktop.updatedAt = Date.now();

    void this.runPrompt(record, runId, input.text.trim());
    return { runId, sessionId };
  }

  async steer(runId: string, input: AgentInput): Promise<void> {
    this.assertAlive();
    const sessionId = this.runToSession.get(runId);
    if (!sessionId) {
      throw new DomainError(agentError('RUN_NOT_FOUND', `Run ${runId} not found`));
    }
    const record = this.requireSession(sessionId);
    await record.pi.steer(input.text);
  }

  async followUp(sessionId: string, input: AgentInput): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    if (record.pi.isStreaming) {
      await record.pi.followUp(input.text);
      return;
    }
    await this.sendMessage(sessionId, input);
  }

  async abort(runId: string): Promise<void> {
    this.assertAlive();
    const sessionId = this.runToSession.get(runId);
    if (!sessionId) return;
    const record = this.sessions.get(sessionId);
    if (!record) return;

    record.abortedRunIds.add(runId);
    try {
      await record.pi.abort();
      record.pi.abortBash();
      // Best-effort: if Pi tracked shell PIDs on the session agent, also kill
      // any residual child pids we can discover from the session process env.
      // Primary process-tree guarantee is validated in process-tree tests.
    } catch (error) {
      console.error('[PiAgentRuntime] abort error', error);
    }

    this.emit({
      type: 'run.cancelled',
      projectId: record.desktop.projectId,
      sessionId: record.desktop.id,
      runId,
      sequence: ++record.sequence,
      timestamp: Date.now(),
    });

    if (record.activeRunId === runId) {
      record.activeRunId = null;
    }
  }

  async setModel(sessionId: string, model: ModelRef): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    await this.applyModel(record.pi, model);
    record.desktop.updatedAt = Date.now();
  }

  async approve(_requestId: string, _decision: ApprovalDecision): Promise<void> {
    this.assertAlive();
    // M5 will connect approvals to Pi tool hooks.
  }

  async listModels(): Promise<Array<{ providerId: string; modelId: string; displayName: string }>> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    return this.modelRuntime!.getModels().map((m) => ({
      providerId: String(m.provider),
      modelId: String(m.id),
      displayName: String(m.name ?? m.id),
    }));
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    for (const record of this.sessions.values()) {
      try {
        record.unsubscribePi();
        if (record.pi.isStreaming) {
          await record.pi.abort();
        }
        record.pi.abortBash();
        record.pi.dispose();
      } catch (error) {
        console.error('[PiAgentRuntime] dispose session error', error);
      }
    }
    this.sessions.clear();
    this.runToSession.clear();
    this.listeners.clear();
    this.modelRuntime = null;
    this.authSummaries = [];
    this.disposed = true;
  }

  private async runPrompt(record: SessionRecord, runId: string, text: string): Promise<void> {
    try {
      await record.pi.prompt(text);
    } catch (error) {
      if (record.abortedRunIds.has(runId)) return;
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: 'run.failed',
        projectId: record.desktop.projectId,
        sessionId: record.desktop.id,
        runId,
        sequence: ++record.sequence,
        timestamp: Date.now(),
        error: agentError('PI_PROMPT_FAILED', message, {
          retryable: /api key|auth|credential|login|no model/i.test(message),
        }),
      });
      if (record.activeRunId === runId) {
        record.activeRunId = null;
      }
    }
  }

  private onPiEvent(record: SessionRecord, event: PiSessionEventLike): void {
    const runId = record.activeRunId;
    if (!runId || record.abortedRunIds.has(runId)) return;

    const mapped = mapPiSessionEvent(event, {
      projectId: record.desktop.projectId,
      sessionId: record.desktop.id,
      runId,
      nextSequence: () => ++record.sequence,
      ensureMessageId: () => {
        record.currentMessageId ??= randomUUID();
        return record.currentMessageId;
      },
      clearMessageId: () => {
        record.currentMessageId = null;
      },
    });

    for (const desktopEvent of mapped) {
      this.emit(desktopEvent);
    }

    if (event.type === 'agent_end' || event.type === 'agent_settled') {
      if (record.activeRunId === runId) {
        record.activeRunId = null;
      }
    }
  }

  private async applyModel(session: PiAgentSession, ref: ModelRef): Promise<void> {
    await this.ensureRuntime(process.cwd());
    const model = this.modelRuntime!.getModel(ref.providerId, ref.modelId);
    if (!model) {
      throw new DomainError(
        agentError(
          'MODEL_NOT_FOUND',
          `Model ${ref.providerId}/${ref.modelId} not found in ModelRuntime`,
        ),
      );
    }
    await session.setModel(model);
  }

  private async ensureRuntime(projectPath: string): Promise<void> {
    if (this.modelRuntime) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      if (!this.agentDir) {
        this.agentDir = path.join(projectPath, '.pi-desktop', 'agent');
      }
      this.modelRuntime = await ModelRuntime.create({
        allowModelNetwork: this.allowModelNetwork,
      });
      if (this.hydrateEnvAuth) {
        this.authSummaries = await hydrateRuntimeAuthFromEnv(this.modelRuntime);
        const sources = describeAuthSources(this.authSummaries);
        if (sources !== 'none') {
          console.warn(`[PiAgentRuntime] env auth providers: ${sources}`);
        } else {
          console.warn(
            '[PiAgentRuntime] no provider API keys in env; prompts will fail until credentials are configured',
          );
        }
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new DomainError(agentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
    }
    return record;
  }

  private emit(event: DesktopAgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[PiAgentRuntime] listener error', error);
      }
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new DomainError(agentError('RUNTIME_DISPOSED', 'AgentRuntime has been disposed'));
    }
  }
}
