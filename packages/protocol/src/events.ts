import { z } from 'zod';

import { ModelRefSchema } from './commands.js';

/** Shared scope fields for every agent event (plan §8). */
export const EventScopeSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
});
export type EventScope = z.infer<typeof EventScopeSchema>;

export const RiskLevelSchema = z.enum([
  'safe',
  'workspace-write',
  'sensitive',
  'destructive',
  'external-side-effect',
]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AgentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
  details: z.unknown().optional(),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

export const DesktopAgentEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('run.started'),
      model: ModelRefSchema.optional(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('run.completed'),
      summary: z.string().optional(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('run.failed'),
      error: AgentErrorSchema,
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('run.cancelled'),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('message.delta'),
      messageId: z.string(),
      role: z.enum(['assistant', 'user', 'system']),
      delta: z.string(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('message.completed'),
      messageId: z.string(),
      role: z.enum(['assistant', 'user', 'system']),
      content: z.string(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('thinking.delta'),
      messageId: z.string(),
      delta: z.string(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('thinking.completed'),
      messageId: z.string(),
      content: z.string(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('tool.requested'),
      toolCallId: z.string(),
      toolName: z.string(),
      inputSummary: z.string(),
      riskLevel: RiskLevelSchema.optional(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('tool.progress'),
      toolCallId: z.string(),
      chunk: z.string(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('tool.completed'),
      toolCallId: z.string(),
      toolName: z.string(),
      ok: z.boolean(),
      outputSummary: z.string().optional(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('approval.requested'),
      requestId: z.string(),
      toolName: z.string(),
      summary: z.string(),
      command: z.string().optional(),
      affectedPaths: z.array(z.string()),
      riskLevel: RiskLevelSchema,
      reasons: z.array(z.string()),
      rememberable: z.boolean(),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('approval.resolved'),
      requestId: z.string(),
      decision: z.enum(['allow-once', 'allow-session', 'allow-project', 'deny']),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('files.changed'),
      paths: z.array(z.string()),
    })
    .merge(EventScopeSchema),
  z
    .object({
      type: z.literal('usage.updated'),
      inputTokens: z.number().nonnegative().optional(),
      outputTokens: z.number().nonnegative().optional(),
      totalTokens: z.number().nonnegative().optional(),
      costUsd: z.number().nonnegative().optional(),
    })
    .merge(EventScopeSchema),
]);
export type DesktopAgentEvent = z.infer<typeof DesktopAgentEventSchema>;
