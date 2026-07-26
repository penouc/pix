import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession as PiAgentSession,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentEventListener,
  AgentInput,
  AgentRuntime,
  AgentSession,
  AfterWriteToolHandler,
  BeforeWriteToolHandler,
  CreateSessionOptions,
} from '@pi-desktop/agent-domain';
import { DomainError, agentError } from '@pi-desktop/agent-domain';
import type { ApprovalDecision, DesktopAgentEvent, ModelRef, RunRef } from '@pi-desktop/protocol';
import { PermissionPipeline, type ApprovalMode, type RememberedRule } from '@pi-desktop/security';

import {
  describeAuthSources,
  hydrateRuntimeAuthFromEnv,
  type ProviderAuthSummary,
} from './credentials.js';
import { mapPiSessionEvent, type PiSessionEventLike } from './event-mapper.js';
import { PermissionController } from './permission-controller.js';

/** Maximum wall-clock time a single run may take before auto-abort (§14.1). */
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 30_000;
const MAX_RUN_TIMEOUT_MS = 2_147_483_647;

export function resolveRunTimeoutMs(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs)) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, timeoutMs));
}

const RUN_TIMEOUT_MS = resolveRunTimeoutMs(process.env['PI_DESKTOP_RUN_TIMEOUT_MS']);

export function writeToolPath(toolName: string, input: unknown): string | undefined {
  if (toolName !== 'write' && toolName !== 'edit') return undefined;
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as { path?: unknown }).path;
  return typeof value === 'string' ? value : undefined;
}

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
  private permissionPipeline: PermissionPipeline | null = null;
  /** Mode chosen before the pipeline exists; applied when it is constructed. */
  private pendingDefaultMode: ApprovalMode | null = null;
  private readonly pendingSessionModes = new Map<string, ApprovalMode>();
  private beforeWriteToolHandler: BeforeWriteToolHandler | null = null;
  private afterWriteToolHandler: AfterWriteToolHandler | null = null;
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
    const desktopId = options.id ?? randomUUID();

    let piSession: PiAgentSession;
    const recordHolder: { value?: SessionRecord } = {};
    try {
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.projectPath,
        agentDir: this.agentDir!,
        extensionFactories: [
          {
            name: 'pi-desktop-permissions',
            factory: (pi) => {
              const permissions = new PermissionController({
                pipeline: this.permissionPipeline!,
                getScope: () => {
                  const current = recordHolder.value;
                  if (!current?.activeRunId) return null;
                  return {
                    context: {
                      projectId: current.desktop.projectId,
                      sessionId: current.desktop.id,
                      runId: current.activeRunId,
                      workspaceRoot: current.projectPath,
                      projectTrusted: true,
                    },
                    nextEventScope: () => ({
                      projectId: current.desktop.projectId,
                      sessionId: current.desktop.id,
                      runId: current.activeRunId!,
                      sequence: ++current.sequence,
                      timestamp: Date.now(),
                    }),
                  };
                },
                emit: (event) => this.emit(event),
              });
              pi.on('tool_call', async (event) => {
                await permissions.authorize({
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: event.input,
                });
                const toolPath = writeToolPath(event.toolName, event.input);
                const activeRunId = recordHolder.value?.activeRunId;
                if (toolPath && activeRunId && this.beforeWriteToolHandler) {
                  await this.beforeWriteToolHandler({
                    runId: activeRunId,
                    toolName: event.toolName as 'write' | 'edit',
                    path: toolPath,
                  });
                }
              });
              pi.on('tool_result', async (event) => {
                const toolPath = writeToolPath(event.toolName, event.input);
                const activeRunId = recordHolder.value?.activeRunId;
                if (toolPath && activeRunId && !event.isError && this.afterWriteToolHandler) {
                  await this.afterWriteToolHandler({
                    runId: activeRunId,
                    toolName: event.toolName as 'write' | 'edit',
                    path: toolPath,
                  });
                }
              });
            },
          },
        ],
      });
      await resourceLoader.reload();
      const result = await createAgentSession({
        cwd: options.projectPath,
        agentDir: this.agentDir!,
        modelRuntime: this.modelRuntime!,
        sessionManager: SessionManager.inMemory(),
        resourceLoader,
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
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
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
    recordHolder.value = record;

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
    } else if (!record.pi.model) {
      const fallback = await this.pickDefaultModel();
      if (fallback) {
        await this.applyModel(record.pi, fallback);
      }
    }

    if (!record.pi.model) {
      throw new DomainError(
        agentError(
          'NO_MODEL',
          'No model selected and no authenticated provider available. Set OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY (or another supported key) and retry.',
          { retryable: true },
        ),
      );
    }

    const runId = randomUUID();
    record.activeRunId = runId;
    record.sequence = 0;
    record.currentMessageId = null;
    this.runToSession.set(runId, sessionId);
    record.desktop.updatedAt = Date.now();

    // Emit run.started early so UI leaves idle even before Pi agent_start.
    this.emit({
      type: 'run.started',
      projectId: record.desktop.projectId,
      sessionId: record.desktop.id,
      runId,
      sequence: ++record.sequence,
      timestamp: Date.now(),
      model: {
        providerId: String(record.pi.model.provider),
        modelId: String(record.pi.model.id),
      },
    });

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

  async setApprovalMode(mode: ApprovalMode, sessionId?: string): Promise<void> {
    if (!sessionId) {
      this.pendingDefaultMode = mode;
      this.permissionPipeline?.policy.setDefaultMode(mode);
      return;
    }
    if (this.permissionPipeline) {
      this.permissionPipeline.policy.setSessionMode(sessionId, mode);
    } else {
      this.pendingSessionModes.set(sessionId, mode);
    }
  }

  async getApprovalMode(sessionId?: string): Promise<ApprovalMode> {
    if (this.permissionPipeline) return this.permissionPipeline.policy.getMode(sessionId);
    if (sessionId && this.pendingSessionModes.has(sessionId)) {
      return this.pendingSessionModes.get(sessionId)!;
    }
    return this.pendingDefaultMode ?? 'auto-reads';
  }

  async listRememberedDecisions(): Promise<RememberedRule[]> {
    return this.permissionPipeline?.policy.listRemembered() ?? [];
  }

  async clearRememberedDecisions(filter?: {
    scope?: 'session' | 'project';
    scopeId?: string;
  }): Promise<number> {
    return this.permissionPipeline?.policy.clearRemembered(filter) ?? 0;
  }

  async configureProvider(providerId: string, apiKey: string): Promise<void> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    await this.modelRuntime!.setRuntimeApiKey(providerId, apiKey);
    this.authSummaries = this.authSummaries.map((summary) =>
      summary.providerId === providerId
        ? { ...summary, hasAuth: true, source: 'runtime' }
        : summary,
    );
  }

  async removeProviderConfiguration(providerId: string): Promise<void> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    await this.modelRuntime!.setRuntimeApiKey(providerId, '');
    this.authSummaries = this.authSummaries.map((summary) =>
      summary.providerId === providerId ? { ...summary, hasAuth: false, source: 'none' } : summary,
    );
  }

  async approve(requestId: string, decision: ApprovalDecision): Promise<void> {
    this.assertAlive();
    if (!this.permissionPipeline?.resolve(requestId, decision)) {
      throw new DomainError(agentError('APPROVAL_NOT_FOUND', 'Approval request was not found.'));
    }
  }

  async listModels(): Promise<
    Array<{ providerId: string; modelId: string; displayName: string; hasAuth?: boolean }>
  > {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    const authSet = new Set(this.authSummaries.filter((s) => s.hasAuth).map((s) => s.providerId));
    return this.modelRuntime!.getModels().map((m) => {
      const providerId = String(m.provider);
      return {
        providerId,
        modelId: String(m.id),
        displayName: String(m.name ?? m.id),
        hasAuth:
          authSet.has(providerId) ||
          this.modelRuntime!.getProviderAuthStatus(providerId)?.configured,
      };
    });
  }

  async pickDefaultModel(): Promise<ModelRef | null> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    const models = await this.listModels();
    const withAuth = models.find((m) => m.hasAuth);
    const chosen = withAuth ?? models[0];
    if (!chosen) return null;
    return { providerId: chosen.providerId, modelId: chosen.modelId };
  }

  setBeforeWriteToolHandler(handler: BeforeWriteToolHandler): void {
    this.beforeWriteToolHandler = handler;
  }

  setAfterWriteToolHandler(handler: AfterWriteToolHandler): void {
    this.afterWriteToolHandler = handler;
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
    this.permissionPipeline = null;
    this.disposed = true;
  }

  private async runPrompt(record: SessionRecord, runId: string, text: string): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Run timed out after ${RUN_TIMEOUT_MS / 1000}s`));
        void this.abort(runId);
      }, RUN_TIMEOUT_MS);
    });

    try {
      await Promise.race([record.pi.prompt(text), timeoutPromise]);
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
    } finally {
      clearTimeout(timeoutHandle);
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
      this.permissionPipeline = new PermissionPipeline({
        auditFilePath: path.join(this.agentDir!, 'security-audit.jsonl'),
        ...(this.pendingDefaultMode ? { defaultMode: this.pendingDefaultMode } : {}),
      });
      for (const [sessionId, mode] of this.pendingSessionModes) {
        this.permissionPipeline.policy.setSessionMode(sessionId, mode);
      }
      this.pendingSessionModes.clear();
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
