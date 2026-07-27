import { z } from 'zod';

export const ModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const CreateSessionInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().optional(),
  model: ModelRefSchema.optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const SendMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
  model: ModelRefSchema.optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const AbortRunInputSchema = z.object({
  runId: z.string().min(1),
});
export type AbortRunInput = z.infer<typeof AbortRunInputSchema>;

export const SteerRunInputSchema = z.object({
  runId: z.string().min(1),
  text: z.string().min(1),
});
export type SteerRunInput = z.infer<typeof SteerRunInputSchema>;

export const FollowUpInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
  model: ModelRefSchema.optional(),
});
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
  model: ModelRefSchema.optional(),
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
  model: ModelRefSchema,
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
  ]),
  value: z.boolean(),
});

export const ApprovalModeSchema = z.enum(['ask', 'auto-reads', 'read-only']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

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

export const SetThinkingLevelInputSchema = z.object({
  level: ThinkingLevelSchema,
  sessionId: z.string().min(1).optional(),
});
export type SetThinkingLevelInput = z.infer<typeof SetThinkingLevelInputSchema>;

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
  z.object({ method: z.literal('session.create'), params: CreateSessionInputSchema }),
  z.object({
    method: z.literal('session.list'),
    params: z.object({ projectId: z.string().min(1) }),
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
  z.object({ method: z.literal('agent.setThinkingLevel'), params: SetThinkingLevelInputSchema }),
  z.object({
    method: z.literal('agent.getThinkingLevel'),
    params: z.object({ sessionId: z.string().min(1).optional() }).optional(),
  }),
  z.object({ method: z.literal('permissions.listRemembered'), params: z.object({}).optional() }),
  z.object({
    method: z.literal('permissions.clearRemembered'),
    params: ClearRememberedInputSchema.optional(),
  }),
  z.object({ method: z.literal('system.revealPath'), params: RevealPathInputSchema }),
]);
export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcMethod = IpcCommand['method'];
