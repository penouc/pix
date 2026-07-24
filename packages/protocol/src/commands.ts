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

export const OpenProjectInputSchema = z.object({
  path: z.string().min(1),
});
export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;

export const SetProjectTrustInputSchema = z.object({
  projectId: z.string().min(1),
  trusted: z.boolean(),
});
export type SetProjectTrustInput = z.infer<typeof SetProjectTrustInputSchema>;

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

/** Discriminated command envelope for typed invoke. */
export const IpcCommandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('app.getInfo'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.open'), params: OpenProjectInputSchema }),
  z.object({ method: z.literal('project.pickFolder'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.listRecent'), params: z.object({}).optional() }),
  z.object({ method: z.literal('project.setTrust'), params: SetProjectTrustInputSchema }),
  z.object({ method: z.literal('session.create'), params: CreateSessionInputSchema }),
  z.object({ method: z.literal('session.list'), params: z.object({ projectId: z.string().min(1) }) }),
  z.object({ method: z.literal('session.rename'), params: RenameSessionInputSchema }),
  z.object({ method: z.literal('session.archive'), params: ArchiveSessionInputSchema }),
  z.object({ method: z.literal('agent.sendMessage'), params: SendMessageInputSchema }),
  z.object({ method: z.literal('agent.abort'), params: AbortRunInputSchema }),
  z.object({ method: z.literal('agent.setModel'), params: SetModelInputSchema }),
  z.object({ method: z.literal('agent.resolveApproval'), params: ResolveApprovalInputSchema }),
  z.object({ method: z.literal('agent.listModels'), params: z.object({}).optional() }),
  z.object({ method: z.literal('agent.authStatus'), params: z.object({}).optional() }),
]);
export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcMethod = IpcCommand['method'];
