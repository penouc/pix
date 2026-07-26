import type { ApprovalDecision, DesktopAgentEvent, ModelRef, RunRef } from '@pi-desktop/protocol';

export interface CreateSessionOptions {
  /**
   * Desktop-owned identity used when rehydrating metadata from SQLite after an
   * app restart. SDK session state itself remains in-memory.
   */
  id?: string;
  projectId: string;
  projectPath: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  model?: ModelRef;
}

export interface AgentSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentInput {
  text: string;
  model?: ModelRef;
}

export type AgentEventListener = (event: DesktopAgentEvent) => void;

/** Main-owned, blocking hook invoked immediately before a write/edit tool executes. */
export type BeforeWriteToolHandler = (input: {
  runId: string;
  toolName: 'write' | 'edit';
  path: string;
}) => Promise<void>;

/** Main-owned hook invoked only after a write/edit tool succeeds. */
export type AfterWriteToolHandler = (input: {
  runId: string;
  toolName: 'write' | 'edit';
  path: string;
}) => Promise<void>;

/**
 * Desktop-owned AgentRuntime boundary (plan §7).
 * Pi SDK types must never leak past implementers of this interface.
 */
/**
 * One model as the catalogue knows it. The capability and price fields come from
 * Pi's bundled models.dev data and are optional throughout: a catalogue that
 * omits a number must not be reported as zero.
 */
export interface ModelCatalogEntry {
  providerId: string;
  modelId: string;
  displayName: string;
  hasAuth?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
  /** USD per million input tokens. */
  inputCostPerMTok?: number;
  /** USD per million output tokens. */
  outputCostPerMTok?: number;
}

/**
 * One provider as Pi's registry describes it, including which auth methods it
 * declares. The labels are the provider's own — "xAI API key", "Sign in with
 * SuperGrok or X Premium" — so nothing here is transcribed by hand.
 */
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  /** Label for the API-key field, when the provider accepts one. */
  apiKeyLabel?: string;
  /** Present when the provider supports subscription/OAuth login. */
  oauthLabel?: string;
  /** The provider's own call to action, e.g. "Sign in with Kimi Code". */
  oauthLoginLabel?: string;
  /** True when a credential is already resolvable from any source. */
  hasAuth?: boolean;
  /**
   * True only when the stored credential is an OAuth one.
   *
   * Distinct from `hasAuth` on purpose: an ambient API key (an env var, another
   * tool's auth store) makes a provider usable without any subscription being
   * connected, and showing that as "signed in" would be a lie.
   */
  oauthConnected?: boolean;
  /** How many models this provider contributes to the catalogue. */
  modelCount: number;
}

/** What a login flow needs the user to see. Mirrors Pi's AuthEvent. */
export type ProviderLoginNotice =
  | { kind: 'info'; message: string; links?: Array<{ url: string; label?: string }> }
  | { kind: 'auth_url'; url: string; instructions?: string }
  | {
      kind: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { kind: 'progress'; message: string };

/** What a login flow needs the user to answer. Mirrors Pi's AuthPrompt. */
export interface ProviderLoginQuestion {
  message: string;
  kind: 'text' | 'password' | 'manual_code' | 'select';
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
}

export interface AgentRuntime {
  createSession(options: CreateSessionOptions): Promise<AgentSession>;
  resumeSession(sessionId: string): Promise<AgentSession>;
  sendMessage(sessionId: string, input: AgentInput): Promise<RunRef>;
  steer(runId: string, input: AgentInput): Promise<void>;
  followUp(sessionId: string, input: AgentInput): Promise<void>;
  abort(runId: string): Promise<void>;
  setModel(sessionId: string, model: ModelRef): Promise<void>;
  configureProvider?(providerId: string, apiKey: string): Promise<void>;
  /**
   * Approval policy. Omitting `sessionId` sets the default for new sessions.
   * See packages/security ApprovalMode for the three behaviours.
   */
  setApprovalMode?(mode: 'ask' | 'auto-reads' | 'read-only', sessionId?: string): Promise<void>;
  getApprovalMode?(sessionId?: string): Promise<'ask' | 'auto-reads' | 'read-only'>;
  /** Remembered allow-session / allow-project rules, for display. No secrets. */
  listRememberedDecisions?(): Promise<
    Array<{
      scope: 'session' | 'project';
      scopeId: string;
      toolName: string;
      riskLevel: string;
      focus: string;
      key: string;
    }>
  >;
  clearRememberedDecisions?(filter?: {
    scope?: 'session' | 'project';
    scopeId?: string;
  }): Promise<number>;
  removeProviderConfiguration?(providerId: string): Promise<void>;
  approve(requestId: string, decision: ApprovalDecision): Promise<void>;
  listModels(): Promise<ModelCatalogEntry[]>;
  /** Optional: every provider Pi knows, with its declared auth methods. */
  listProviders?(): Promise<ProviderCatalogEntry[]>;
  /**
   * Optional: run a provider login (subscription/OAuth or interactive api-key).
   *
   * Resolves when the credential has been stored by the SDK and rejects on
   * failure or cancellation. It deliberately returns nothing — the credential is
   * the SDK's to keep, and passing it back would put a live token on a code path
   * that has no reason to hold one.
   */
  loginProvider?(input: {
    providerId: string;
    type: 'oauth' | 'apiKey';
    notify: (notice: ProviderLoginNotice) => void;
    ask: (question: ProviderLoginQuestion) => Promise<string>;
    signal?: AbortSignal;
  }): Promise<void>;
  /** Optional: forget a stored credential for this provider. */
  logoutProvider?(providerId: string): Promise<void>;
  /** Optional: which providers currently have usable credentials (no secrets). */
  getAuthStatus?(): Promise<Array<{ providerId: string; hasAuth: boolean; source: string }>>;
  /** Optional: choose a default model when the session has none. */
  pickDefaultModel?(): Promise<ModelRef | null>;
  /**
   * Installs Main's checkpoint hook. Implementations must await it before a
   * write/edit tool executes and must not expose SDK-specific event types.
   */
  setBeforeWriteToolHandler?(handler: BeforeWriteToolHandler): void;
  /**
   * Installs Main's post-write checkpoint hook. Implementations must invoke it
   * only after a successful write/edit and must not expose SDK event types.
   */
  setAfterWriteToolHandler?(handler: AfterWriteToolHandler): void;
  subscribe(listener: AgentEventListener): () => void;
  dispose(): Promise<void>;
}
