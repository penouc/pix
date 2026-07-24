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

/** Discriminated command envelope for typed invoke. */
export const IpcCommandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('app.getInfo'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.open'), params: OpenProjectInputSchema }),
  z.object({ method: z.literal('project.pickFolder'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.listRecent'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.setTrust'), params: SetProjectTrustInputSchema }),
  z.object({ method: z.literal('git.getWorkingTreeDiff'), params: GetWorkingTreeDiffInputSchema }),
  z.object({ method: z.literal('provider.list'), params: z.object({}).optional() }),
  z.object({ method: z.literal('provider.saveApiKey'), params: SaveProviderApiKeyInputSchema }),
  z.object({ method: z.literal('provider.remove'), params: RemoveProviderInputSchema }),
  z.object({ method: z.literal('settings.get'), params: z.object({}).optional() }),
  z.object({ method: z.literal('settings.setDefaultModel'), params: SetDefaultModelInputSchema }),
  z.object({ method: z.literal('session.create'), params: CreateSessionInputSchema }),
  z.object({
    method: z.literal('session.list'),
    params: z.object({ projectId: z.string().min(1) }),
  }),
  z.object({ method: z.literal('session.rename'), params: RenameSessionInputSchema }),
  z.object({ method: z.literal('session.archive'), params: ArchiveSessionInputSchema }),
  z.object({ method: z.literal('agent.sendMessage'), params: SendMessageInputSchema }),
  z.object({ method: z.literal('agent.steer'), params: SteerRunInputSchema }),
  z.object({ method: z.literal('agent.followUp'), params: FollowUpInputSchema }),
  z.object({ method: z.literal('agent.abort'), params: AbortRunInputSchema }),
  z.object({ method: z.literal('agent.setModel'), params: SetModelInputSchema }),
  z.object({ method: z.literal('agent.resolveApproval'), params: ResolveApprovalInputSchema }),
  z.object({ method: z.literal('agent.listModels'), params: z.object({}).optional() }),
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
]);
export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcMethod = IpcCommand['method'];
