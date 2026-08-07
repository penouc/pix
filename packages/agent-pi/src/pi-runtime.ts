import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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
  ModelCatalogEntry,
  ProviderCatalogEntry,
  ProviderLoginNotice,
  ProviderLoginQuestion,
} from '@pi-desktop/agent-domain';
import { DomainError, agentError } from '@pi-desktop/agent-domain';
import type {
  ApprovalDecision,
  AutoModelConfig,
  CompactionResult,
  ContextUsage,
  DesktopAgentEvent,
  ModelRef,
  ModelSelection,
  RunRef,
  StoredMessage,
  ThinkingLevel,
  ThinkingLevelState,
  SessionMode,
} from '@pi-desktop/protocol';
import { PermissionPipeline, type ApprovalMode, type RememberedRule } from '@pi-desktop/security';

import { AutoModelRouter, classifyAutoSwitchError, type AutoRole } from './auto-model.js';

import {
  describeAuthSources,
  hydrateRuntimeAuthFromEnv,
  type ProviderAuthSummary,
} from './credentials.js';
import { extractTextContent, mapPiSessionEvent, type PiSessionEventLike } from './event-mapper.js';
import { PermissionController } from './permission-controller.js';
import {
  buildSessionTitleUserPrompt,
  sanitizeSessionTitle,
  SESSION_TITLE_SYSTEM_PROMPT,
} from './session-title.js';

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

/** Pi's `Model<Api>` is `{ provider, id, ... }` — reduce it to the desktop ref. */
function toModelRef(model: { provider: unknown; id: unknown }): ModelRef {
  return {
    providerId: String(model.provider),
    modelId: String(model.id),
  };
}

function roleForMode(mode: SessionMode): AutoRole {
  return mode === 'plan' ? 'plan' : 'default';
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
  /** The SDK prompt may still be unwinding just after it emits `agent_end`. */
  promptTask: Promise<void> | null;
  abortedRunIds: Set<string>;
  currentMessageId: string | null;
  /** Last compaction reason for pairing start/end events. */
  compactionReason: 'manual' | 'auto' | null;
  sessionMode: SessionMode;
  /** Tool names to restore when leaving Plan Mode. */
  buildToolNames: string[] | null;
  /**
   * What the session is pinned to: a concrete model or Auto (#21).
   * Defaults to Auto — a fresh session resolves at first send, exactly like
   * the old pickDefaultModel heuristic, but with role routing and fallback.
   */
  modelSelection: ModelSelection;
  /** Auto routing policy, refreshed from Settings on every send. */
  autoConfig: AutoModelConfig | null;
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
  private pendingDefaultWorkMode: SessionMode = 'build';
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
    if (options.id) {
      const existing = this.sessions.get(options.id);
      if (existing) {
        return { ...existing.desktop };
      }
    }
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
        sessionManager: this.sessionManagerFor(desktopId, options.projectPath),
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
        if (options.model.kind === 'model') {
          await this.applyModel(piSession, options.model);
        }
        // Auto needs no SDK-side pin here; the record below records the
        // selection and resolution happens at first send.
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
      promptTask: null,
      abortedRunIds: new Set(),
      currentMessageId: null,
      compactionReason: null,
      sessionMode: 'build',
      buildToolNames: null,
      modelSelection: options.model ?? { kind: 'auto' },
      autoConfig: options.autoModel ?? null,
    };
    recordHolder.value = record;

    // Product guarantee: auto-compaction stays on (Pi default is already true).
    try {
      piSession.setAutoCompactionEnabled(true);
    } catch {
      // Older SDK builds without the setter should not block session create.
    }

    record.unsubscribePi = piSession.subscribe((event) => {
      this.onPiEvent(record, event as PiSessionEventLike);
    });

    this.sessions.set(desktopId, record);
    if (this.pendingDefaultWorkMode !== 'build') {
      await this.applySessionMode(record, this.pendingDefaultWorkMode);
    } else {
      this.permissionPipeline?.policy.setSessionWorkMode(desktopId, 'build');
    }
    this.emitContextUsage(record);
    return { ...desktop };
  }

  /**
   * A persisted session manager for this desktop session, reopening the existing
   * transcript when there is one.
   *
   * This used to be `SessionManager.inMemory()`, which meant Pi never wrote a
   * transcript: reopening a task after a restart showed an empty thread, and the
   * model was handed no history either, so it had no idea what had been discussed.
   *
   * Pi names files `<timestamp>_<id>.jsonl`, so the file for an id has to be found
   * by suffix rather than constructed.
   */
  private sessionManagerFor(desktopId: string, projectPath: string): SessionManager {
    const dir = path.join(this.agentDir!, 'desktop-sessions');
    try {
      mkdirSync(dir, { recursive: true });
      const existing = readdirSync(dir).find(
        (file) => file.endsWith(`_${desktopId}.jsonl`) && existsSync(path.join(dir, file)),
      );
      if (existing) return SessionManager.open(path.join(dir, existing), dir, projectPath);
      return SessionManager.create(projectPath, dir, { id: desktopId });
    } catch (error) {
      // A session that cannot be persisted is still worth having; losing history
      // beats refusing to open the task at all.
      console.warn('[PiAgentRuntime] session persistence unavailable', error);
      console.warn(
        '[PiAgentRuntime] falling back to in-memory transcript — conversations will not survive app restart',
      );
      return SessionManager.inMemory(projectPath, { id: desktopId });
    }
  }

  /**
   * The stored transcript for a session, oldest first.
   *
   * Read from Pi's own message list so it reflects exactly what the model sees,
   * including messages restored from disk. Thinking blocks and tool calls are
   * emitted as structured timeline entries so the renderer can rebuild cards.
   */
  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    return expandPiMessagesToTranscript(
      record.pi.messages as Array<{
        role?: string;
        content?: unknown;
        toolCallId?: string;
        toolName?: string;
      }>,
    );
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    return { ...record.desktop };
  }

  async sendMessage(sessionId: string, input: AgentInput): Promise<RunRef> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    if (!input.text.trim() && !input.images?.length) {
      throw new DomainError(agentError('EMPTY_INPUT', 'A message needs text or an image'));
    }
    // Pi emits `agent_end` (which drives the renderer's completed state) just
    // before prompt() resolves and isStreaming flips to false. A queued message
    // can arrive in that small hand-off window. Wait for that completed prompt
    // to unwind instead of incorrectly rejecting the next queue item.
    if (record.pi.isStreaming && !record.activeRunId && record.promptTask) {
      await record.promptTask;
    }
    // Re-check after waiting: another caller may have started the next run while
    // this one was suspended.
    if (record.pi.isStreaming || record.activeRunId) {
      throw new DomainError(
        agentError('RUN_IN_PROGRESS', 'A run is already active; use follow-up or abort first'),
      );
    }

    if (input.autoModel) {
      record.autoConfig = input.autoModel;
    }
    if (input.model) {
      await this.applyModelSelection(record, input.model);
    } else if (record.modelSelection.kind === 'model' && !record.pi.model) {
      // A pinned selection that has not been applied yet (e.g. a resumed
      // session whose model was never re-applied to the SDK session).
      await this.applyModel(record.pi, record.modelSelection);
    }

    // Auto (#21): resolve the concrete model for this turn's role right before
    // the run, so a switch between Plan and Build picks the matching tier.
    if (record.modelSelection.kind === 'auto') {
      const role: AutoRole = record.sessionMode === 'plan' ? 'plan' : 'default';
      const ref = await this.resolveAutoModel(record, role);
      if (ref) {
        await this.applyModel(record.pi, ref);
      }
    }

    if (!record.pi.model) {
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
    if (input.images?.length && !record.pi.model.input.includes('image')) {
      throw new DomainError(
        agentError('MODEL_NO_IMAGE_INPUT', `${record.pi.model.name} does not accept image input`),
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

    const promptTask = this.runPrompt(record, runId, input.text.trim(), input.images);
    record.promptTask = promptTask;
    void promptTask.then(() => {
      if (record.promptTask === promptTask) {
        record.promptTask = null;
      }
    });
    return { runId, sessionId };
  }

  async steer(runId: string, input: AgentInput): Promise<void> {
    this.assertAlive();
    const sessionId = this.runToSession.get(runId);
    if (!sessionId) {
      throw new DomainError(agentError('RUN_NOT_FOUND', `Run ${runId} not found`));
    }
    const record = this.requireSession(sessionId);
    if (input.images?.length && !record.pi.model?.input.includes('image')) {
      throw new DomainError(
        agentError('MODEL_NO_IMAGE_INPUT', 'The current model does not accept image input'),
      );
    }
    await record.pi.steer(
      input.text,
      input.images?.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })),
    );
  }

  async followUp(sessionId: string, input: AgentInput): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    if (input.images?.length && record.pi.model && !record.pi.model.input.includes('image')) {
      throw new DomainError(
        agentError('MODEL_NO_IMAGE_INPUT', 'The current model does not accept image input'),
      );
    }
    if (record.pi.isStreaming) {
      await record.pi.followUp(
        input.text,
        input.images?.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })),
      );
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
    // A tool hook can be blocked on an approval promise. Deny those requests
    // before asking Pi to abort or Stop waits forever for a decision the user
    // is explicitly trying to cancel.
    for (const pending of this.permissionPipeline?.listPending() ?? []) {
      if (pending.runId === runId) {
        this.permissionPipeline?.resolve(pending.requestId, 'deny');
      }
    }
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

  async setModel(sessionId: string, model: ModelSelection): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    await this.applyModelSelection(record, model);
    record.desktop.updatedAt = Date.now();
  }

  async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    record.pi.setThinkingLevel(level);
    record.desktop.updatedAt = Date.now();
  }

  async getThinkingLevel(sessionId: string): Promise<ThinkingLevelState> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    return {
      level: record.pi.thinkingLevel,
      available: record.pi.getAvailableThinkingLevels(),
      supportsThinking: record.pi.supportsThinking(),
    };
  }

  async getContextUsage(sessionId: string): Promise<ContextUsage | null> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    return this.readContextUsage(record);
  }

  async compact(sessionId: string, customInstructions?: string): Promise<CompactionResult> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    record.compactionReason = 'manual';
    try {
      const result = await record.pi.compact(customInstructions);
      // Pi subscribe events usually cover start/end; emit a completed event if
      // the SDK returned without a matching compaction_end (tests / older builds).
      if (record.compactionReason === 'manual') {
        this.emit({
          type: 'compaction.completed',
          projectId: record.desktop.projectId,
          sessionId: record.desktop.id,
          timestamp: Date.now(),
          aborted: false,
          reason: 'manual',
          summary: result.summary,
          tokensBefore: result.tokensBefore,
          ...(result.estimatedTokensAfter != null
            ? { estimatedTokensAfter: result.estimatedTokensAfter }
            : {}),
        });
      }
      this.emitContextUsage(record);
      record.desktop.updatedAt = Date.now();
      return {
        summary: result.summary,
        tokensBefore: result.tokensBefore,
        ...(result.estimatedTokensAfter != null
          ? { estimatedTokensAfter: result.estimatedTokensAfter }
          : {}),
      };
    } catch (error) {
      this.emit({
        type: 'compaction.completed',
        projectId: record.desktop.projectId,
        sessionId: record.desktop.id,
        timestamp: Date.now(),
        aborted: true,
        reason: 'manual',
        summary: error instanceof Error ? error.message : String(error),
      });
      throw new DomainError(
        agentError(
          'PI_COMPACT_FAILED',
          error instanceof Error ? error.message : String(error),
          { details: error },
        ),
      );
    } finally {
      record.compactionReason = null;
    }
  }

  async setAutoCompactionEnabled(enabled: boolean, sessionId?: string): Promise<void> {
    this.assertAlive();
    if (!sessionId) {
      // Applied when sessions are created; also update every live session.
      for (const record of this.sessions.values()) {
        record.pi.setAutoCompactionEnabled(enabled);
      }
      return;
    }
    const record = this.requireSession(sessionId);
    record.pi.setAutoCompactionEnabled(enabled);
  }

  async getAutoCompactionEnabled(sessionId?: string): Promise<boolean> {
    this.assertAlive();
    if (sessionId) {
      return this.requireSession(sessionId).pi.autoCompactionEnabled;
    }
    const first = this.sessions.values().next().value as SessionRecord | undefined;
    return first?.pi.autoCompactionEnabled ?? true;
  }

  async abortCompaction(sessionId: string): Promise<void> {
    this.assertAlive();
    const record = this.requireSession(sessionId);
    record.pi.abortCompaction();
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

  async setSessionMode(mode: SessionMode, sessionId?: string): Promise<void> {
    this.assertAlive();
    if (!sessionId) {
      this.pendingDefaultWorkMode = mode;
      this.permissionPipeline?.policy.setDefaultWorkMode(mode);
      for (const record of this.sessions.values()) {
        await this.applySessionMode(record, mode);
      }
      return;
    }
    const record = this.requireSession(sessionId);
    await this.applySessionMode(record, mode);
  }

  async getSessionMode(sessionId?: string): Promise<SessionMode> {
    this.assertAlive();
    if (sessionId) {
      const record = this.sessions.get(sessionId);
      // Session may exist in SQLite but not yet be hydrated into the runtime.
      return record?.sessionMode ?? this.pendingDefaultWorkMode;
    }
    return this.pendingDefaultWorkMode;
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

  async listModels(): Promise<ModelCatalogEntry[]> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    const authSet = new Set(this.authSummaries.filter((s) => s.hasAuth).map((s) => s.providerId));
    return this.modelRuntime!.getModels().map((m) => {
      const providerId = String(m.provider);
      const record = m as {
        contextWindow?: number;
        maxTokens?: number;
        reasoning?: boolean;
        input?: Array<'text' | 'image'>;
        cost?: { input?: number; output?: number };
      };
      /*
       * Capability and price come from Pi's bundled models.dev catalogue, which
       * carries exactly what models.dev publishes — context window, max output,
       * reasoning support, and USD per million tokens. Passing it through means
       * the picker can show it without fetching anything or estimating anything;
       * a field the catalogue omits stays undefined rather than becoming 0.
       */
      return {
        providerId,
        modelId: String(m.id),
        displayName: String(m.name ?? m.id),
        hasAuth:
          authSet.has(providerId) ||
          this.modelRuntime!.getProviderAuthStatus(providerId)?.configured,
        ...(typeof record.contextWindow === 'number' && record.contextWindow > 0
          ? { contextWindow: record.contextWindow }
          : {}),
        ...(typeof record.maxTokens === 'number' && record.maxTokens > 0
          ? { maxOutputTokens: record.maxTokens }
          : {}),
        ...(typeof record.reasoning === 'boolean' ? { reasoning: record.reasoning } : {}),
        ...(Array.isArray(record.input) ? { supportsImages: record.input.includes('image') } : {}),
        ...(typeof record.cost?.input === 'number' ? { inputCostPerMTok: record.cost.input } : {}),
        ...(typeof record.cost?.output === 'number'
          ? { outputCostPerMTok: record.cost.output }
          : {}),
      };
    });
  }

  /**
   * Every provider Pi knows, straight from its registry.
   *
   * The Settings screen used to carry a hand-written list of sixteen ids. Pi
   * knows thirty-seven, so twenty-one were unreachable — and a transcribed list
   * is exactly the kind of thing that drifts silently as the SDK moves. It also
   * could not know which providers accept a subscription login, because only the
   * registry says so.
   */
  async listProviders(): Promise<ProviderCatalogEntry[]> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    const counts = new Map<string, number>();
    for (const model of this.modelRuntime!.getModels()) {
      const id = String(model.provider);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const authSet = new Set(this.authSummaries.filter((s) => s.hasAuth).map((s) => s.providerId));

    // `getProviders()` is typed by the SDK; no cast, so a shape change in Pi
    // surfaces here as a compile error rather than as undefined at runtime.
    return this.modelRuntime!.getProviders()
      .map((provider): ProviderCatalogEntry => {
        const hasAuth =
          authSet.has(provider.id) ||
          this.modelRuntime!.getProviderAuthStatus(provider.id)?.configured === true;
        return {
          id: provider.id,
          name: provider.name ?? provider.id,
          ...(provider.auth?.apiKey?.name ? { apiKeyLabel: provider.auth.apiKey.name } : {}),
          ...(provider.auth?.oauth?.name ? { oauthLabel: provider.auth.oauth.name } : {}),
          ...(provider.auth?.oauth?.loginLabel
            ? { oauthLoginLabel: provider.auth.oauth.loginLabel }
            : {}),
          hasAuth,
          oauthConnected: this.modelRuntime!.isUsingOAuth(provider.id) === true,
          modelCount: counts.get(provider.id) ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Run a provider login through Pi's own flow.
   *
   * Pi drives it: its `login` calls back with what the user must see (a device
   * code, an authorisation URL) and occasionally with something to answer (a
   * pasted code). This adapts those callbacks to plain functions the desktop can
   * bridge, and returns nothing — `Models.login` persists the credential in the
   * SDK's own CredentialStore, so no token passes through this layer at all.
   */
  async loginProvider(input: {
    providerId: string;
    type: 'oauth' | 'apiKey';
    notify: (notice: ProviderLoginNotice) => void;
    ask: (question: ProviderLoginQuestion) => Promise<string>;
    signal?: AbortSignal;
  }): Promise<void> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());

    await this.modelRuntime!.login(input.providerId, input.type === 'oauth' ? 'oauth' : 'api_key', {
      ...(input.signal ? { signal: input.signal } : {}),
      notify: (event) => {
        switch (event.type) {
          case 'device_code':
            input.notify({
              kind: 'device_code',
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              ...(event.intervalSeconds ? { intervalSeconds: event.intervalSeconds } : {}),
              ...(event.expiresInSeconds ? { expiresInSeconds: event.expiresInSeconds } : {}),
            });
            return;
          case 'auth_url':
            input.notify({
              kind: 'auth_url',
              url: event.url,
              ...(event.instructions ? { instructions: event.instructions } : {}),
            });
            return;
          case 'info':
            input.notify({
              kind: 'info',
              message: event.message,
              ...(event.links ? { links: event.links.map((l) => ({ ...l })) } : {}),
            });
            return;
          case 'progress':
            input.notify({ kind: 'progress', message: event.message });
            return;
        }
      },
      prompt: async (prompt) =>
        input.ask({
          message: prompt.message,
          kind:
            prompt.type === 'select'
              ? 'select'
              : prompt.type === 'manual_code'
                ? 'manual_code'
                : 'text',
          ...('placeholder' in prompt && prompt.placeholder
            ? { placeholder: prompt.placeholder }
            : {}),
          ...(prompt.type === 'select'
            ? { options: prompt.options.map((option) => ({ ...option })) }
            : {}),
        }),
    });

    // The cached auth view is what `hasAuth` is read from, so mark this provider
    // configured — otherwise its models stay unselectable until a restart.
    this.markProviderAuth(input.providerId, true);
  }

  async logoutProvider(providerId: string): Promise<void> {
    this.assertAlive();
    await this.ensureRuntime(process.cwd());
    await this.modelRuntime!.logout(providerId);
    this.markProviderAuth(providerId, false);
  }

  /** Keep the cached auth view in step with a login/logout. */
  private markProviderAuth(providerId: string, hasAuth: boolean): void {
    const existing = this.authSummaries.find((summary) => summary.providerId === providerId);
    if (existing) {
      this.authSummaries = this.authSummaries.map((summary) =>
        summary.providerId === providerId
          ? { ...summary, hasAuth, source: hasAuth ? 'runtime' : 'none' }
          : summary,
      );
      return;
    }
    if (hasAuth) {
      this.authSummaries = [
        ...this.authSummaries,
        { providerId, hasAuth: true, source: 'runtime' },
      ];
    }
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

  /**
   * One cheap completion with the session's current model. Separate from the
   * agent transcript so naming never pollutes the coding thread.
   */
  async generateSessionTitle(sessionId: string): Promise<string | null> {
    this.assertAlive();
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    await this.ensureRuntime(record.projectPath);
    const model = record.pi.model;
    if (!model || !this.modelRuntime) return null;

    const snippets = collectTitleSnippets(
      record.pi.messages as Array<{ role?: string; content?: unknown }>,
    );
    if (!snippets.userText) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const reply = await this.modelRuntime.completeSimple(
        model,
        {
          systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildSessionTitleUserPrompt(snippets),
              timestamp: Date.now(),
            },
          ],
        },
        {
          maxTokens: 48,
          temperature: 0.2,
          signal: controller.signal,
        },
      );
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
        return null;
      }
      return sanitizeSessionTitle(extractTextContent(reply.content));
    } catch (error) {
      console.warn('[PiAgentRuntime] generateSessionTitle failed', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
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

  private async runPrompt(
    record: SessionRecord,
    runId: string,
    text: string,
    images?: AgentInput['images'],
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Run timed out after ${RUN_TIMEOUT_MS / 1000}s`));
        void this.abort(runId);
      }, RUN_TIMEOUT_MS);
    });

    /**
     * How many Auto fallback switches a single run may do (#21). Each switch
     * tries the next model in the chain on the same user turn; bounding it
     * keeps a chain of broken models from turning one prompt into a loop.
     */
    const MAX_AUTO_SWITCHES = 2;

    try {
      // Attempt 0 is a fresh prompt. Later attempts are the same turn retried
      // on the next model, via agent.continue() — the user message is already
      // in the transcript, so calling prompt() again would duplicate it.
      let attempt = 0;
      for (;;) {
        try {
          if (attempt === 0) {
            await Promise.race([
              record.pi.prompt(text, {
                images: images?.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })),
              }),
              timeoutPromise,
            ]);
          } else {
            await Promise.race([record.pi.agent.continue(), timeoutPromise]);
          }
          return;
        } catch (error) {
          if (record.abortedRunIds.has(runId)) return;

          const auto = record.modelSelection.kind === 'auto';
          const reason = auto ? classifyAutoSwitchError(error) : null;
          const current = record.pi.model ? toModelRef(record.pi.model) : null;
          const next =
            reason && current && attempt < MAX_AUTO_SWITCHES
              ? await this.nextAutoModel(record, roleForMode(record.sessionMode), current)
              : null;

          if (next && current && reason) {
            attempt += 1;
            // Pi's own retry path removes the error assistant message before
            // continue(); mirror that so the retried turn resumes from the
            // pending user prompt / tool results.
            const messages = record.pi.agent.state.messages;
            const last = messages[messages.length - 1] as
              | { role?: string; errorMessage?: string }
              | undefined;
            if (last && last.role === 'assistant' && last.errorMessage) {
              record.pi.agent.state.messages = messages.slice(0, -1);
            }
            await this.applyModel(record.pi, next);
            // agent_end / agent_settled from the failed attempt cleared the
            // active run id; the run continues, so put it back before the
            // retried turn streams.
            record.activeRunId = runId;
            this.emit({
              type: 'model.auto-switched',
              projectId: record.desktop.projectId,
              sessionId: record.desktop.id,
              runId,
              sequence: ++record.sequence,
              timestamp: Date.now(),
              from: current,
              to: next,
              reason,
            });
            continue;
          }

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
          return;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private onPiEvent(record: SessionRecord, event: PiSessionEventLike): void {
    // Compaction can fire outside an active run (threshold between turns).
    if (event.type === 'compaction_start') {
      const reason = record.compactionReason ?? 'auto';
      if (!record.compactionReason) record.compactionReason = 'auto';
      this.emit({
        type: 'compaction.started',
        projectId: record.desktop.projectId,
        sessionId: record.desktop.id,
        timestamp: Date.now(),
        reason,
      });
      return;
    }
    if (event.type === 'compaction_end') {
      const reason = record.compactionReason ?? 'auto';
      const result = event['result'] as
        | {
            summary?: string;
            tokensBefore?: number;
            estimatedTokensAfter?: number;
          }
        | undefined;
      this.emit({
        type: 'compaction.completed',
        projectId: record.desktop.projectId,
        sessionId: record.desktop.id,
        timestamp: Date.now(),
        aborted: Boolean(event['aborted']),
        reason,
        ...(typeof result?.summary === 'string' ? { summary: result.summary } : {}),
        ...(typeof result?.tokensBefore === 'number' ? { tokensBefore: result.tokensBefore } : {}),
        ...(typeof result?.estimatedTokensAfter === 'number'
          ? { estimatedTokensAfter: result.estimatedTokensAfter }
          : {}),
      });
      record.compactionReason = null;
      this.emitContextUsage(record);
      return;
    }

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
      if (desktopEvent.type === 'run.completed' && record.sessionMode === 'plan') {
        // Plan Mode (#3): capture the draft for the Approve → Build flow. The
        // renderer needs it as data on the completion event, not a hidden
        // transcript read, so the plan card can be rebuilt after a rerender.
        const planText = extractLastAssistantText(
          record.pi.messages as Array<{ role?: string; content?: unknown }>,
        );
        this.emit({ ...desktopEvent, ...(planText ? { planText } : {}) });
        continue;
      }
      this.emit(desktopEvent);
    }

    if (event.type === 'message_end' || event.type === 'agent_end' || event.type === 'agent_settled') {
      this.emitContextUsage(record);
    }

    if (event.type === 'agent_end' || event.type === 'agent_settled') {
      if (record.activeRunId === runId) {
        record.activeRunId = null;
      }
    }
  }

  private readContextUsage(record: SessionRecord): ContextUsage | null {
    try {
      const usage = record.pi.getContextUsage();
      if (!usage || typeof usage.contextWindow !== 'number' || usage.contextWindow <= 0) {
        return null;
      }
      return {
        tokens: usage.tokens == null ? null : usage.tokens,
        contextWindow: usage.contextWindow,
        percent: usage.percent == null ? null : usage.percent,
      };
    } catch {
      return null;
    }
  }

  private emitContextUsage(record: SessionRecord): void {
    const usage = this.readContextUsage(record);
    if (!usage) return;
    this.emit({
      type: 'context.updated',
      projectId: record.desktop.projectId,
      sessionId: record.desktop.id,
      timestamp: Date.now(),
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
    });
  }

  private async applySessionMode(record: SessionRecord, mode: SessionMode): Promise<void> {
    const PLAN_TOOLS = ['read', 'grep', 'find', 'ls'];
    const BUILD_TOOLS = ['read', 'bash', 'edit', 'write'];

    if (mode === 'plan') {
      if (record.sessionMode !== 'plan') {
        try {
          record.buildToolNames = record.pi.getActiveToolNames?.() ?? BUILD_TOOLS;
        } catch {
          record.buildToolNames = BUILD_TOOLS;
        }
      }
      try {
        record.pi.setActiveToolsByName(PLAN_TOOLS);
      } catch (error) {
        throw new DomainError(
          agentError(
            'PI_SESSION_MODE_FAILED',
            error instanceof Error ? error.message : String(error),
            { details: error },
          ),
        );
      }
    } else {
      const restore = record.buildToolNames?.length ? record.buildToolNames : BUILD_TOOLS;
      try {
        record.pi.setActiveToolsByName(restore);
      } catch (error) {
        throw new DomainError(
          agentError(
            'PI_SESSION_MODE_FAILED',
            error instanceof Error ? error.message : String(error),
            { details: error },
          ),
        );
      }
      record.buildToolNames = null;
    }

    record.sessionMode = mode;
    this.permissionPipeline?.policy.setSessionWorkMode(record.desktop.id, mode);
    record.desktop.updatedAt = Date.now();
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

  /**
   * Apply a picker selection. Auto records the mode without pinning a concrete
   * model — the role-based resolution happens at send time.
   */
  private async applyModelSelection(
    record: SessionRecord,
    selection: ModelSelection,
  ): Promise<void> {
    if (selection.kind === 'model') {
      record.modelSelection = selection;
      await this.applyModel(record.pi, selection);
      return;
    }
    record.modelSelection = { kind: 'auto' };
  }

  private async autoRouter(record: SessionRecord): Promise<AutoModelRouter> {
    const models = await this.listModels();
    return new AutoModelRouter(record.autoConfig ?? undefined, models);
  }

  private async resolveAutoModel(
    record: SessionRecord,
    role: AutoRole,
  ): Promise<ModelRef | null> {
    const router = await this.autoRouter(record);
    return router.resolve(role);
  }

  private async nextAutoModel(
    record: SessionRecord,
    role: AutoRole,
    current: ModelRef,
  ): Promise<ModelRef | null> {
    const router = await this.autoRouter(record);
    return router.next(role, current);
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

/**
 * Text of a Pi message, whatever shape its content takes.
 *
 * Content is a string for simple messages and an array of typed parts otherwise;
 * anything that is not text (an image, a tool call) contributes nothing here.
 */
function flattenMessageText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('')
    .trim();
}

/**
 * Last assistant prose in a transcript — the plan draft a Plan-mode run
 * produced. Returns null when the run ended without any assistant text.
 */
export function extractLastAssistantText(
  messages: Array<{ role?: string; content?: unknown }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    const text = flattenMessageText(message.content);
    if (text) return text;
  }
  return null;
}

const MAX_HISTORY_ARG_SUMMARY = 200;
const MAX_HISTORY_TOOL_OUTPUT = 500;

function summarizeToolArgs(toolName: string, args: unknown): string {
  if (args == null) return toolName;
  if (typeof args === 'string') return `${toolName}: ${args.slice(0, MAX_HISTORY_ARG_SUMMARY)}`;
  if (typeof args === 'object') {
    const rec = args as Record<string, unknown>;
    const pathLike = rec['path'] ?? rec['file_path'] ?? rec['filePath'] ?? rec['command'];
    if (typeof pathLike === 'string') return `${toolName}: ${pathLike}`;
  }
  try {
    return `${toolName}: ${JSON.stringify(args).slice(0, MAX_HISTORY_ARG_SUMMARY)}`;
  } catch {
    return toolName;
  }
}

/**
 * Expand Pi's message list into the desktop transcript timeline: user/assistant
 * prose, thinking cards, and tool cards (with results when present).
 */
export function expandPiMessagesToTranscript(
  messages: Array<{
    role?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  }>,
): StoredMessage[] {
  const out: StoredMessage[] = [];
  const toolIndexById = new Map<string, number>();

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const text = flattenMessageText(message.content);
      const images = Array.isArray(message.content)
        ? message.content
            .filter((part): part is { type: 'image'; data: string; mimeType: string } =>
              Boolean(
                part &&
                typeof part === 'object' &&
                (part as { type?: unknown }).type === 'image' &&
                typeof (part as { data?: unknown }).data === 'string' &&
                typeof (part as { mimeType?: unknown }).mimeType === 'string',
              ),
            )
            .map((image, index) => ({
              name: `Image ${index + 1}`,
              mimeType: image.mimeType,
              size:
                Math.floor((image.data.length * 3) / 4) -
                (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0),
            }))
        : [];
      if (text || images.length) {
        out.push({ kind: 'message', role: 'user', text, ...(images.length ? { images } : {}) });
      }
      continue;
    }

    if (message.role === 'toolResult') {
      const toolCallId = String(message.toolCallId ?? '');
      const idx = toolIndexById.get(toolCallId);
      if (idx == null) continue;
      const existing = out[idx];
      if (!existing || existing.kind !== 'tool') continue;
      const output = flattenMessageText(message.content).slice(0, MAX_HISTORY_TOOL_OUTPUT);
      out[idx] = {
        ...existing,
        status: message.isError ? 'failed' : 'completed',
        ok: !message.isError,
        outputSummary: output || existing.outputSummary,
      };
      continue;
    }

    if (message.role !== 'assistant') continue;

    const parts = Array.isArray(message.content)
      ? message.content
      : typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : [];

    let textParts: string[] = [];
    const flushText = () => {
      const text = textParts.join('').trim();
      textParts = [];
      if (text) out.push({ kind: 'message', role: 'assistant', text });
    };

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const rec = part as Record<string, unknown>;
      const type = rec['type'];

      if (type === 'thinking' && typeof rec['thinking'] === 'string') {
        flushText();
        const content = rec['thinking'].trim();
        if (content) {
          out.push({
            kind: 'thinking',
            id: `pi-think-${out.length}`,
            content,
          });
        }
        continue;
      }

      if (type === 'toolCall') {
        flushText();
        const id = String(rec['id'] ?? `pi-tool-${out.length}`);
        const toolName = String(rec['name'] ?? 'tool');
        toolIndexById.set(id, out.length);
        out.push({
          kind: 'tool',
          id,
          toolName,
          inputSummary: summarizeToolArgs(toolName, rec['arguments']),
          status: 'completed',
        });
        continue;
      }

      if (type === 'text' && typeof rec['text'] === 'string') {
        textParts.push(rec['text']);
      }
    }
    flushText();
  }

  return out;
}

function collectTitleSnippets(messages: Array<{ role?: string; content?: unknown }>): {
  userText: string;
  assistantText?: string;
} {
  let userText = '';
  let assistantText = '';
  for (const message of messages) {
    const role = message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = extractTextContent(message.content).trim();
    if (!text) continue;
    if (role === 'user' && !userText) userText = text;
    if (role === 'assistant') assistantText = text;
  }
  return assistantText ? { userText, assistantText } : { userText };
}
