import { z } from 'zod';

import { IpcCommandSchema, ModelRefSchema } from './commands.js';
import { DesktopAgentEventSchema } from './events.js';

export const IpcSuccessSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

export const IpcFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const IpcResultSchema = z.discriminatedUnion('ok', [IpcSuccessSchema, IpcFailureSchema]);
export type IpcResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function okResult<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function errResult(code: string, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } };
}

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  electron: z.string(),
  piSdk: z.string().optional(),
  runtimeMode: z.enum(['pi', 'fake']).optional(),
  authProviders: z.string().optional(),
  /**
   * Real paths and policy values, so the Settings screen reports what the code
   * enforces rather than a transcription that drifts.
   */
  paths: z
    .object({
      database: z.string(),
      logs: z.string(),
      audit: z.string(),
      userData: z.string(),
    })
    .optional(),
  policy: z
    .object({
      protectedBasenames: z.array(z.string()),
      protectedDirectories: z.array(z.string()),
      resolvedCheckpointRetentionDays: z.number().int().nonnegative(),
      terminalTimeoutSeconds: z.number().int().nonnegative(),
      terminalOutputCapBytes: z.number().int().nonnegative(),
    })
    .optional(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const UpdateStateSchema = z.object({
  status: z.enum([
    'idle',
    'checking',
    'available',
    'downloading',
    'downloaded',
    'not-available',
    'error',
    'unsupported',
  ]),
  currentVersion: z.string(),
  version: z.string().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  releaseDate: z.string().optional(),
  releaseNotes: z.string().optional(),
  error: z.string().optional(),
});
export type UpdateState = z.infer<typeof UpdateStateSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  trusted: z.boolean(),
  isGit: z.boolean(),
  lastOpenedAt: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ChangedFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  binary: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const WorkingTreeDiffSchema = z.object({
  projectId: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  files: z.array(ChangedFileSchema),
});
export type WorkingTreeDiff = z.infer<typeof WorkingTreeDiffSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archived: z.boolean(),
  /**
   * Soft delete. Set means hidden from the task list; nothing is destroyed, so
   * the run's checkpoints and snapshots stay recoverable (plan §11 / M7).
   */
  deletedAt: z.number().int().nonnegative().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** One stored timeline entry for replaying a task's transcript. */
export const StoredMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    role: z.enum(['user', 'assistant', 'system']),
    text: z.string(),
    /** Attachment metadata only; image bytes remain in Pi's session store. */
    images: z
      .array(
        z.object({
          name: z.string(),
          mimeType: z.string(),
          size: z.number().int().nonnegative(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal('thinking'),
    id: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('tool'),
    id: z.string().min(1),
    toolName: z.string().min(1),
    inputSummary: z.string(),
    outputSummary: z.string().optional(),
    ok: z.boolean().optional(),
    status: z.enum(['running', 'completed', 'failed']),
  }),
]);
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const RunRefSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
});
export type RunRef = z.infer<typeof RunRefSchema>;

export const CheckpointRecoverySummarySchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  workspacePath: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type CheckpointRecoverySummary = z.infer<typeof CheckpointRecoverySummarySchema>;

export const ModelInfoSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  hasAuth: z.boolean().optional(),
  /*
   * Capability and price, straight from Pi's bundled models.dev catalogue — the
   * same numbers models.dev publishes, already local, so nothing is fetched and
   * nothing is guessed. Every field is optional because a provider may report
   * none of it, and an absent value must read as "not reported" rather than 0.
   */
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoning: z.boolean().optional(),
  supportsImages: z.boolean().optional(),
  /** USD per million input tokens. */
  inputCostPerMTok: z.number().nonnegative().optional(),
  /** USD per million output tokens. */
  outputCostPerMTok: z.number().nonnegative().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/**
 * State of an in-flight provider login, polled by the Renderer.
 *
 * Never carries a token: the SDK stores the credential itself, so the only thing
 * crossing IPC is what the user has to see or answer.
 */
export const ProviderLoginStateSchema = z.object({
  loginId: z.string(),
  providerId: z.string(),
  phase: z.enum([
    'starting',
    /** A code to type into the browser page we opened. */
    'device_code',
    /** A URL to authorise at. */
    'auth_url',
    /** The flow needs an answer (a pasted code, a choice). */
    'question',
    /** Talking to the provider; nothing for the user to do. */
    'working',
    'done',
    'failed',
    'cancelled',
  ]),
  /** Progress text, instructions, or the failure reason. */
  message: z.string().optional(),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  questionKind: z.enum(['text', 'password', 'manual_code', 'select']).optional(),
  placeholder: z.string().optional(),
  options: z
    .array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() }))
    .optional(),
});
export type ProviderLoginState = z.infer<typeof ProviderLoginStateSchema>;

/** One provider from Pi's registry, with the auth methods it declares. */
export const ProviderCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Label for the API-key field, in the provider's own words. */
  apiKeyLabel: z.string().optional(),
  /** Present when the provider supports a subscription/OAuth login. */
  oauthLabel: z.string().optional(),
  oauthLoginLabel: z.string().optional(),
  hasAuth: z.boolean().optional(),
  /** True only when the stored credential is an OAuth one, not an api key. */
  oauthConnected: z.boolean().optional(),
  modelCount: z.number().int().nonnegative(),
});
export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntrySchema>;

export const ProviderSettingSchema = z.object({
  providerId: z.string(),
  configured: z.boolean(),
});
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;

export const UiFlagsSchema = z.object({
  trustNewProjects: z.boolean(),
  reopenLastProject: z.boolean(),
  /** Notifications — the design's "long runs should be able to page you". */
  notifyApprovalRequired: z.boolean(),
  notifyRunFinished: z.boolean(),
  notifyAutomationOpenedTask: z.boolean(),
  notifyPlaySound: z.boolean(),
  notifyBadgeDock: z.boolean(),
  notifyOnlyWhenBackground: z.boolean(),
  /** Check GitHub Releases and download compatible updates in the background. */
  autoUpdate: z.boolean(),
  /** Starting directory for the folder picker. Empty = the OS default. */
  defaultProjectsFolder: z.string(),
});
export type UiFlags = z.infer<typeof UiFlagsSchema>;

/** One remembered allow rule, as shown in Settings. */
export const RememberedRuleSchema = z.object({
  scope: z.enum(['session', 'project']),
  scopeId: z.string(),
  toolName: z.string(),
  riskLevel: z.string(),
  focus: z.string(),
  key: z.string(),
});
export type RememberedRule = z.infer<typeof RememberedRuleSchema>;

/** One day of agent activity, for the usage heatmap. */
export const UsageDaySchema = z.object({
  date: z.string(),
  runs: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type UsageDay = z.infer<typeof UsageDaySchema>;

export const UsageByModelSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  runs: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  lastUsedAt: z.number().int().nonnegative(),
});
export type UsageByModel = z.infer<typeof UsageByModelSchema>;

export const UsageSummarySchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  totals: z.object({
    runs: z.number().int().nonnegative(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    medianDurationMs: z.number().nonnegative().nullable(),
  }),
  days: z.array(UsageDaySchema),
  byModel: z.array(UsageByModelSchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** One indexed project, for the Indexing settings section. */
export const IndexProjectStatusSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
  trusted: z.boolean(),
  indexing: z.boolean(),
  files: z.number().int().nonnegative(),
  indexedBytes: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** null when the project has never been indexed. */
  updatedAt: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type IndexProjectStatus = z.infer<typeof IndexProjectStatusSchema>;

const IndexHitSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  /** Absolute project root, so a hit in another project can be acted on. */
  projectPath: z.string(),
  /** Project-relative file path. */
  path: z.string(),
});

export const IndexSearchResultSchema = z.object({
  paths: z.array(IndexHitSchema),
  content: z.array(IndexHitSchema.extend({ excerpt: z.string() })),
});
export type IndexHit = z.infer<typeof IndexHitSchema>;
export type IndexSearchResult = z.infer<typeof IndexSearchResultSchema>;

/** Local audit-log summary for the Permissions tab. */
export const AuditSummarySchema = z.object({
  path: z.string(),
  events: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  exists: z.boolean(),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;

export const SettingsSchema = z.object({
  defaultModel: ModelRefSchema.optional(),
  uiFlags: UiFlagsSchema.optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-run metrics collected in Main (plan §14 / M8-2). */
export const RunMetricsSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  firstTokenAt: z.number().int().nonnegative().optional(),
  toolCallCount: z.number().int().nonnegative(),
  fileChangeCount: z.number().int().nonnegative(),
  outcome: z.enum(['completed', 'failed', 'cancelled', 'timedout']).optional(),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

/** A skill discovered on disk — selected with `$`, sent to Pi as `/skill:name`. */
export const SkillInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  description: z.string(),
  scope: z.enum(['global', 'project']),
  filePath: z.string(),
  enabled: z.boolean(),
});
export type SkillInfo = z.infer<typeof SkillInfoSchema>;

/** Outcome of one user-run terminal command. */
export const TerminalResultSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  /** 'ran' — executed; 'denied' — refused by policy; 'cancelled' — approval denied. */
  outcome: z.enum(['ran', 'denied', 'cancelled']),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export type TerminalResult = z.infer<typeof TerminalResultSchema>;

/** Result of a `cd`. On refusal the tab stays where it was. */
export const TerminalCwdResultSchema = z.object({
  outcome: z.enum(['changed', 'refused']),
  /** Absolute directory the tab should use from now on. */
  cwd: z.string(),
  /** Same directory relative to the project root; `.` at the root itself. */
  relative: z.string(),
  reason: z.string().optional(),
});
export type TerminalCwdResult = z.infer<typeof TerminalCwdResultSchema>;

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  projectName: z.string().optional(),
  prompt: z.string(),
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('manual') }),
    z.object({ kind: z.literal('interval'), everyMinutes: z.number().int() }),
    z.object({ kind: z.literal('daily'), atMinute: z.number().int() }),
    z.object({ kind: z.literal('event'), on: z.literal('run-completed') }),
  ]),
  approvalMode: z.enum(['ask', 'auto-reads', 'read-only', 'unattended']),
  note: z.string().optional(),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  /** When the current enabled period began; anchors never-run schedules. */
  enabledAt: z.number().int().nonnegative().optional(),
  lastRunAt: z.number().int().nonnegative().optional(),
  lastRunSummary: z.string().optional(),
  nextRunAt: z.number().int().nonnegative().optional(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationRunRefSchema = z.object({
  automationId: z.string(),
  sessionId: z.string(),
  runId: z.string().optional(),
});
export type AutomationRunRef = z.infer<typeof AutomationRunRefSchema>;

/** Validate inbound invoke payload from Renderer. */
export function parseIpcCommand(raw: unknown) {
  return IpcCommandSchema.safeParse(raw);
}

/** Validate outbound agent events before sending to Renderer. */
export function parseDesktopAgentEvent(raw: unknown) {
  return DesktopAgentEventSchema.safeParse(raw);
}

export type { IpcCommand } from './commands.js';
export type { DesktopAgentEvent } from './events.js';
