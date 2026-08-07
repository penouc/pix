import { z } from 'zod';

export const ModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

/**
 * What a picker can pin for a session: a concrete model, or **Auto**.
 *
 * Auto is the #21 capability — the runtime picks the model per task and role,
 * and on rate-limit / timeout / quota failures advances down a fallback chain
 * instead of failing the run. It is deliberately a discriminated union rather
 * than a sentinel provider id (`providerId: 'auto'` would collide with a real
 * provider the moment one is named "auto").
 */
export const ModelSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('model'),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }),
  z.object({ kind: z.literal('auto') }),
]);
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

/** Wrap a concrete ref in the selection shape. */
export function modelSelectionFromRef(ref: ModelRef): ModelSelection {
  return { kind: 'model', providerId: ref.providerId, modelId: ref.modelId };
}

/**
 * Ordered Auto-model routing policy, configured in Settings and applied by the
 * runtime on every Auto run.
 *
 * Keys are `providerId/modelId` strings so they reuse the picker's identity.
 * Every field is optional: absent entries fall back to the derived ordering
 * (cheapest runnable first for the default role, reasoning-capable first for
 * the plan role). `fallbackKeys` is what makes #21's fallback chain
 * user-configurable.
 */
export const AutoModelConfigSchema = z.object({
  /** `providerId/modelId` pinned to the default (cheap / fast) role. */
  defaultKey: z.string().min(1).optional(),
  /** `providerId/modelId` pinned to the plan (strong / reasoning) role. */
  planKey: z.string().min(1).optional(),
  /** Ordered `providerId/modelId` fallback chain after the role pick. */
  fallbackKeys: z.array(z.string().min(1)).max(50).optional(),
});
export type AutoModelConfig = z.infer<typeof AutoModelConfigSchema>;

export const SetAutoModelConfigInputSchema = z.object({
  config: AutoModelConfigSchema,
});
export type SetAutoModelConfigInput = z.infer<typeof SetAutoModelConfigInputSchema>;

export const CreateSessionInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().optional(),
  model: ModelSelectionSchema.optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const InputImageSchema = z.object({
  /** Raw base64 only (no data-URL prefix). */
  data: z
    .string()
    .min(1)
    .max(14_000_000)
    .refine(
      (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
      'Image data must be valid base64',
    ),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  name: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export type InputImage = z.infer<typeof InputImageSchema>;

const MessageContentShape = {
  text: z.string().max(100_000),
  images: z.array(InputImageSchema).max(4).optional(),
};

function decodedBase64Bytes(data: string): number {
  return Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

function validateMessageContent(
  value: { text: string; images?: InputImage[] },
  ctx: z.RefinementCtx,
): void {
  if (!value.text.trim() && !value.images?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A message needs text or an image' });
  }
  for (const [index, image] of (value.images ?? []).entries()) {
    if (decodedBase64Bytes(image.data) > 10 * 1024 * 1024) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['images', index, 'data'],
        message: 'Each image may be at most 10 MB',
      });
    }
  }
  const totalBytes =
    value.images?.reduce((sum, image) => sum + decodedBase64Bytes(image.data), 0) ?? 0;
  if (totalBytes > 20 * 1024 * 1024) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Images may total at most 20 MB' });
  }
}

export const SendMessageInputSchema = z
  .object({
    ...MessageContentShape,
    sessionId: z.string().min(1),
    model: ModelSelectionSchema.optional(),
  })
  .superRefine(validateMessageContent);
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const AbortRunInputSchema = z.object({
  runId: z.string().min(1),
});
export type AbortRunInput = z.infer<typeof AbortRunInputSchema>;

export const SteerRunInputSchema = z
  .object({ ...MessageContentShape, runId: z.string().min(1) })
  .superRefine(validateMessageContent);
export type SteerRunInput = z.infer<typeof SteerRunInputSchema>;

export const FollowUpInputSchema = z
  .object({
    ...MessageContentShape,
    sessionId: z.string().min(1),
    model: ModelSelectionSchema.optional(),
  })
  .superRefine(validateMessageContent);
export type FollowUpInput = z.infer<typeof FollowUpInputSchema>;

export const OpenProjectInputSchema = z.object({
  path: z.string().min(1),
});
export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;

export const SetProjectTrustInputSchema = z.object({
  projectId: z.string().min(1),
  trusted: z.boolean(),
});
export type SetProjectTrustInput = z.infer<typeof SetProjectTrustInputSchema>;

export const GetWorkingTreeDiffInputSchema = z.object({
  projectId: z.string().min(1),
});
export type GetWorkingTreeDiffInput = z.infer<typeof GetWorkingTreeDiffInputSchema>;

export const SaveProviderApiKeyInputSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(1).max(10_000),
});
export type SaveProviderApiKeyInput = z.infer<typeof SaveProviderApiKeyInputSchema>;

export const RemoveProviderInputSchema = z.object({
  providerId: z.string().min(1),
});
export type RemoveProviderInput = z.infer<typeof RemoveProviderInputSchema>;

export const SetDefaultModelInputSchema = z.object({
  model: ModelSelectionSchema.optional(),
});
export type SetDefaultModelInput = z.infer<typeof SetDefaultModelInputSchema>;

export const RenameSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
});
export type RenameSessionInput = z.infer<typeof RenameSessionInputSchema>;

export const DeleteSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  /** false restores a soft-deleted session. */
  deleted: z.boolean().default(true),
});
export type DeleteSessionInput = z.infer<typeof DeleteSessionInputSchema>;

export const ArchiveSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  archived: z.boolean().default(true),
});
export type ArchiveSessionInput = z.infer<typeof ArchiveSessionInputSchema>;

export const SetModelInputSchema = z.object({
  sessionId: z.string().min(1),
  model: ModelSelectionSchema,
});
export type SetModelInput = z.infer<typeof SetModelInputSchema>;

export const ApprovalDecisionSchema = z.enum([
  'allow-once',
  'allow-session',
  'allow-project',
  'deny',
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ResolveApprovalInputSchema = z.object({
  requestId: z.string().min(1),
  decision: ApprovalDecisionSchema,
});
export type ResolveApprovalInput = z.infer<typeof ResolveApprovalInputSchema>;

export const CheckpointRunInputSchema = z.object({
  runId: z.string().min(1),
});
export const CheckpointRevertFileInputSchema = CheckpointRunInputSchema.extend({
  path: z.string().min(1).max(4096),
});

export const SearchFilesInputSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().max(512),
  limit: z.number().int().positive().max(200).optional(),
});
export type SearchFilesInput = z.infer<typeof SearchFilesInputSchema>;

export const IndexSearchInputSchema = z.object({
  query: z.string().max(512),
  /** Omit to search every trusted project. */
  projectId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(50).optional(),
});
export type IndexSearchInput = z.infer<typeof IndexSearchInputSchema>;

export const ProviderLoginInputSchema = z.object({
  providerId: z.string().min(1),
  /** Which auth method to run; `oauth` is the subscription login. */
  type: z.enum(['oauth', 'apiKey']).default('oauth'),
});
export type ProviderLoginInput = z.infer<typeof ProviderLoginInputSchema>;

export const ProviderLoginIdInputSchema = z.object({
  loginId: z.string().min(1),
});
export type ProviderLoginIdInput = z.infer<typeof ProviderLoginIdInputSchema>;

export const ProviderLoginSubmitInputSchema = ProviderLoginIdInputSchema.extend({
  value: z.string().max(10_000),
});
export type ProviderLoginSubmitInput = z.infer<typeof ProviderLoginSubmitInputSchema>;

export const SetFavoriteModelsInputSchema = z.object({
  /** `provider/model` keys pinned to the top of the picker. */
  keys: z.array(z.string().min(1)).max(500),
});
export type SetFavoriteModelsInput = z.infer<typeof SetFavoriteModelsInputSchema>;

export const IndexTreeInputSchema = z.object({
  projectId: z.string().min(1),
  /** Project-relative directory; omitted or empty means the project root. */
  prefix: z.string().max(4096).optional(),
});
export type IndexTreeInput = z.infer<typeof IndexTreeInputSchema>;

export const OpenExternalInputSchema = z.object({
  /** http/https only — checked in Main, not here, so the reason can be reported. */
  url: z.string().min(1).max(4096),
});
export type OpenExternalInput = z.infer<typeof OpenExternalInputSchema>;

export const IndexRebuildInputSchema = z.object({
  projectId: z.string().min(1),
  /** Discard and re-read everything instead of an incremental pass. */
  force: z.boolean().optional(),
});
export type IndexRebuildInput = z.infer<typeof IndexRebuildInputSchema>;

export const SkillScopeSchema = z.enum(['global', 'project']);
export type SkillScope = z.infer<typeof SkillScopeSchema>;

export const ListSkillsInputSchema = z.object({
  projectId: z.string().min(1).optional(),
});
export type ListSkillsInput = z.infer<typeof ListSkillsInputSchema>;

export const SetSkillEnabledInputSchema = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean(),
  projectId: z.string().min(1).optional(),
});
export type SetSkillEnabledInput = z.infer<typeof SetSkillEnabledInputSchema>;

export const InstallSkillExampleInputSchema = z.object({
  id: z.enum(['code-review', 'test-failure-triage']),
  projectId: z.string().min(1).optional(),
});
export type InstallSkillExampleInput = z.infer<typeof InstallSkillExampleInputSchema>;

export const RevealPathInputSchema = z.object({
  path: z.string().min(1).max(4096),
});
export type RevealPathInput = z.infer<typeof RevealPathInputSchema>;

export const TerminalExecInputSchema = z.object({
  projectId: z.string().min(1),
  command: z.string().min(1).max(8192),
  /** Subdirectory to run in, relative or absolute. Never escapes the root. */
  cwd: z.string().max(4096).optional(),
  sessionId: z.string().min(1).optional(),
});
export type TerminalExecInput = z.infer<typeof TerminalExecInputSchema>;

export const TerminalChangeDirectoryInputSchema = z.object({
  projectId: z.string().min(1),
  /** The tab's current directory. Absolute, or omitted for the project root. */
  cwd: z.string().max(4096).optional(),
  /** The `cd` argument exactly as typed. */
  target: z.string().max(4096),
});
export type TerminalChangeDirectoryInput = z.infer<typeof TerminalChangeDirectoryInputSchema>;

/** How much an automation may do without a human in the loop. */
export const AutomationApprovalModeSchema = z.enum([
  /** Every elevated tool call waits for a person — an unattended run stalls. */
  'ask',
  /** Reads run freely; writes and bash still wait. */
  'auto-reads',
  /** No writes and no bash at all. */
  'read-only',
  /** Writes and bash are approved automatically, above the policy floor. */
  'unattended',
]);
export type AutomationApprovalMode = z.infer<typeof AutomationApprovalModeSchema>;

export const AutomationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('interval'),
    everyMinutes: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 14),
  }),
  z.object({
    kind: z.literal('daily'),
    /** Minutes past local midnight. */
    atMinute: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 - 1),
  }),
  z.object({
    kind: z.literal('event'),
    /** Fires after a run you started finishes — never after an automation's own. */
    on: z.literal('run-completed'),
  }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;

export const AutomationDraftSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  trigger: AutomationTriggerSchema,
  approvalMode: AutomationApprovalModeSchema,
  note: z.string().max(1000).optional(),
  enabled: z.boolean(),
});
export type AutomationDraft = z.infer<typeof AutomationDraftSchema>;

export const AutomationIdInputSchema = z.object({ id: z.string().min(1) });
export const SetAutomationEnabledInputSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export const ListAutomationsInputSchema = z.object({
  projectId: z.string().min(1).optional(),
});

export const SetUiSettingInputSchema = z.object({
  key: z.enum([
    'trustNewProjects',
    'reopenLastProject',
    'notifyApprovalRequired',
    'notifyRunFinished',
    'notifyAutomationOpenedTask',
    'notifyPlaySound',
    'notifyBadgeDock',
    'notifyOnlyWhenBackground',
    'autoUpdate',
  ]),
  value: z.boolean(),
});

export const ApprovalModeSchema = z.enum(['ask', 'auto-reads', 'read-only']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

/** Agent work mode: plan = read-only tools; build = full coding tools. */
export const SessionModeSchema = z.enum(['plan', 'build']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Pi reasoning depth — off through max. Only meaningful on reasoning-capable models. */
export const ThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const ThinkingLevelStateSchema = z.object({
  level: ThinkingLevelSchema,
  available: z.array(ThinkingLevelSchema),
  supportsThinking: z.boolean(),
});
export type ThinkingLevelState = z.infer<typeof ThinkingLevelStateSchema>;

export const SetApprovalModeInputSchema = z.object({
  mode: ApprovalModeSchema,
  /** Omit to change the default applied to new sessions. */
  sessionId: z.string().min(1).optional(),
});
export type SetApprovalModeInput = z.infer<typeof SetApprovalModeInputSchema>;

export const SetSessionModeInputSchema = z.object({
  mode: SessionModeSchema,
  sessionId: z.string().min(1).optional(),
});
export type SetSessionModeInput = z.infer<typeof SetSessionModeInputSchema>;

export const SetThinkingLevelInputSchema = z.object({
  level: ThinkingLevelSchema,
  sessionId: z.string().min(1).optional(),
});
export type SetThinkingLevelInput = z.infer<typeof SetThinkingLevelInputSchema>;

export const SessionIdInputSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionIdInput = z.infer<typeof SessionIdInputSchema>;

export const CompactSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  /** Optional hint for the summarizer (e.g. "keep auth-module context"). */
  customInstructions: z.string().max(4_000).optional(),
});
export type CompactSessionInput = z.infer<typeof CompactSessionInputSchema>;

export const SetAutoCompactionInputSchema = z.object({
  enabled: z.boolean(),
  /** Omit to change the default applied to new sessions. */
  sessionId: z.string().min(1).optional(),
});
export type SetAutoCompactionInput = z.infer<typeof SetAutoCompactionInputSchema>;

export const ContextUsageSchema = z.object({
  tokens: z.number().nonnegative().nullable(),
  contextWindow: z.number().positive(),
  percent: z.number().min(0).max(100).nullable(),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;

export const CompactionResultSchema = z.object({
  summary: z.string(),
  tokensBefore: z.number().nonnegative(),
  estimatedTokensAfter: z.number().nonnegative().optional(),
});
export type CompactionResult = z.infer<typeof CompactionResultSchema>;

export const ClearRememberedInputSchema = z.object({
  scope: z.enum(['session', 'project']).optional(),
  scopeId: z.string().min(1).optional(),
});
export type ClearRememberedInput = z.infer<typeof ClearRememberedInputSchema>;

export const UsageSummaryInputSchema = z.object({
  /** Trailing window in days. 365 suits the calendar heatmap. */
  days: z.number().int().min(1).max(1096).optional(),
  projectId: z.string().min(1).optional(),
});
export type UsageSummaryInput = z.infer<typeof UsageSummaryInputSchema>;

export const SetDefaultProjectsFolderInputSchema = z.object({
  /** Empty string clears it back to the OS default. */
  path: z.string().max(4096),
});
export type SetUiSettingInput = z.infer<typeof SetUiSettingInputSchema>;

/** Discriminated command envelope for typed invoke. */
export const IpcCommandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('app.getInfo'), params: z.object({}).optional() }),
  z.object({ method: z.literal('update.getStatus'), params: z.object({}).optional() }),
  z.object({ method: z.literal('update.check'), params: z.object({}).optional() }),
  z.object({ method: z.literal('update.download'), params: z.object({}).optional() }),
  z.object({ method: z.literal('update.install'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.open'), params: OpenProjectInputSchema }),
  z.object({ method: z.literal('project.pickFolder'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.listRecent'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.openPlayground'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.setTrust'), params: SetProjectTrustInputSchema }),
  z.object({ method: z.literal('git.getWorkingTreeDiff'), params: GetWorkingTreeDiffInputSchema }),
  z.object({ method: z.literal('provider.list'), params: z.object({}).optional() }),
  z.object({ method: z.literal('provider.listAvailable'), params: z.object({}).optional() }),
  z.object({ method: z.literal('provider.login'), params: ProviderLoginInputSchema }),
  z.object({ method: z.literal('provider.loginStatus'), params: ProviderLoginIdInputSchema }),
  z.object({ method: z.literal('provider.loginSubmit'), params: ProviderLoginSubmitInputSchema }),
  z.object({ method: z.literal('provider.loginCancel'), params: ProviderLoginIdInputSchema }),
  z.object({ method: z.literal('provider.logout'), params: RemoveProviderInputSchema }),
  z.object({ method: z.literal('provider.saveApiKey'), params: SaveProviderApiKeyInputSchema }),
  z.object({ method: z.literal('provider.remove'), params: RemoveProviderInputSchema }),
  z.object({ method: z.literal('settings.get'), params: z.object({}).optional() }),
  z.object({ method: z.literal('settings.setDefaultModel'), params: SetDefaultModelInputSchema }),
  z.object({ method: z.literal('settings.getAutoModel'), params: z.object({}).optional() }),
  z.object({ method: z.literal('settings.setAutoModel'), params: SetAutoModelConfigInputSchema }),
  z.object({ method: z.literal('session.create'), params: CreateSessionInputSchema }),
  z.object({
    method: z.literal('session.list'),
    // Omit projectId for a global, recency-ordered list (used by ⌘K).
    params: z.object({ projectId: z.string().min(1).optional() }),
  }),
  z.object({
    method: z.literal('session.messages'),
    params: z.object({ sessionId: z.string().min(1) }),
  }),
  z.object({ method: z.literal('session.rename'), params: RenameSessionInputSchema }),
  z.object({ method: z.literal('session.archive'), params: ArchiveSessionInputSchema }),
  z.object({ method: z.literal('session.delete'), params: DeleteSessionInputSchema }),
  z.object({ method: z.literal('agent.sendMessage'), params: SendMessageInputSchema }),
  z.object({ method: z.literal('agent.steer'), params: SteerRunInputSchema }),
  z.object({ method: z.literal('agent.followUp'), params: FollowUpInputSchema }),
  z.object({ method: z.literal('agent.abort'), params: AbortRunInputSchema }),
  z.object({ method: z.literal('agent.setModel'), params: SetModelInputSchema }),
  z.object({ method: z.literal('agent.resolveApproval'), params: ResolveApprovalInputSchema }),
  z.object({ method: z.literal('agent.listModels'), params: z.object({}).optional() }),
  z.object({ method: z.literal('settings.getFavoriteModels'), params: z.object({}).optional() }),
  z.object({
    method: z.literal('settings.setFavoriteModels'),
    params: SetFavoriteModelsInputSchema,
  }),
  z.object({ method: z.literal('agent.authStatus'), params: z.object({}).optional() }),
  z.object({ method: z.literal('checkpoint.listRecoverable'), params: z.object({}).optional() }),
  z.object({ method: z.literal('checkpoint.review'), params: CheckpointRunInputSchema }),
  z.object({ method: z.literal('checkpoint.keep'), params: CheckpointRunInputSchema }),
  z.object({ method: z.literal('checkpoint.continue'), params: CheckpointRunInputSchema }),
  z.object({
    method: z.literal('checkpoint.revertFile'),
    params: CheckpointRevertFileInputSchema,
  }),
  z.object({ method: z.literal('checkpoint.revertAll'), params: CheckpointRunInputSchema }),
  z.object({ method: z.literal('diagnostics.export'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.searchFiles'), params: SearchFilesInputSchema }),
  z.object({ method: z.literal('git.getBranch'), params: GetWorkingTreeDiffInputSchema }),
  z.object({ method: z.literal('index.search'), params: IndexSearchInputSchema }),
  z.object({ method: z.literal('index.status'), params: z.object({}).optional() }),
  z.object({ method: z.literal('index.tree'), params: IndexTreeInputSchema }),
  z.object({ method: z.literal('system.openExternal'), params: OpenExternalInputSchema }),
  z.object({ method: z.literal('index.rebuild'), params: IndexRebuildInputSchema }),
  z.object({
    method: z.literal('index.forget'),
    params: z.object({ projectId: z.string().min(1) }),
  }),
  z.object({ method: z.literal('skills.list'), params: ListSkillsInputSchema.optional() }),
  z.object({ method: z.literal('skills.setEnabled'), params: SetSkillEnabledInputSchema }),
  z.object({ method: z.literal('skills.installExample'), params: InstallSkillExampleInputSchema }),
  z.object({ method: z.literal('skills.reveal'), params: RevealPathInputSchema }),
  z.object({ method: z.literal('terminal.exec'), params: TerminalExecInputSchema }),
  z.object({
    method: z.literal('terminal.changeDirectory'),
    params: TerminalChangeDirectoryInputSchema,
  }),
  z.object({ method: z.literal('automation.list'), params: ListAutomationsInputSchema.optional() }),
  z.object({ method: z.literal('automation.save'), params: AutomationDraftSchema }),
  z.object({ method: z.literal('automation.delete'), params: AutomationIdInputSchema }),
  z.object({
    method: z.literal('automation.setEnabled'),
    params: SetAutomationEnabledInputSchema,
  }),
  z.object({ method: z.literal('automation.runNow'), params: AutomationIdInputSchema }),
  z.object({ method: z.literal('settings.setUiFlag'), params: SetUiSettingInputSchema }),
  z.object({
    method: z.literal('settings.setDefaultProjectsFolder'),
    params: SetDefaultProjectsFolderInputSchema,
  }),
  z.object({ method: z.literal('settings.pickProjectsFolder'), params: z.object({}).optional() }),
  z.object({ method: z.literal('audit.summary'), params: z.object({}).optional() }),
  z.object({ method: z.literal('usage.summary'), params: UsageSummaryInputSchema.optional() }),
  z.object({ method: z.literal('agent.setApprovalMode'), params: SetApprovalModeInputSchema }),
  z.object({
    method: z.literal('agent.getApprovalMode'),
    params: z.object({ sessionId: z.string().min(1).optional() }).optional(),
  }),
  z.object({ method: z.literal('agent.setSessionMode'), params: SetSessionModeInputSchema }),
  z.object({
    method: z.literal('agent.getSessionMode'),
    params: z.object({ sessionId: z.string().min(1).optional() }).optional(),
  }),
  z.object({ method: z.literal('agent.setThinkingLevel'), params: SetThinkingLevelInputSchema }),
  z.object({
    method: z.literal('agent.getThinkingLevel'),
    params: z.object({ sessionId: z.string().min(1).optional() }).optional(),
  }),
  z.object({ method: z.literal('agent.getContextUsage'), params: SessionIdInputSchema }),
  z.object({ method: z.literal('agent.compact'), params: CompactSessionInputSchema }),
  z.object({ method: z.literal('agent.setAutoCompaction'), params: SetAutoCompactionInputSchema }),
  z.object({
    method: z.literal('agent.getAutoCompaction'),
    params: z.object({ sessionId: z.string().min(1).optional() }).optional(),
  }),
  z.object({ method: z.literal('agent.abortCompaction'), params: SessionIdInputSchema }),
  z.object({ method: z.literal('permissions.listRemembered'), params: z.object({}).optional() }),
  z.object({
    method: z.literal('permissions.clearRemembered'),
    params: ClearRememberedInputSchema.optional(),
  }),
  z.object({ method: z.literal('system.revealPath'), params: RevealPathInputSchema }),
]);
export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcMethod = IpcCommand['method'];
