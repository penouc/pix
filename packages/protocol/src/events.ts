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
      /**
       * Plan Mode (#3): the draft the agent produced in the read-only run,
       * i.e. the last assistant prose. Present only when the completed run
       * happened under Plan Mode, so the UI can offer Approve → Build.
       */
      planText: z.string().max(100_000).optional(),
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
  /**
   * Session metadata changed outside a run stream (e.g. auto-named after the
   * first completed turn). Not run-scoped — no runId/sequence.
   */
  z.object({
    type: z.literal('session.updated'),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    title: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
  }),
  /**
   * Live context-window occupancy from Pi `getContextUsage()`.
   * Session-scoped — compaction can fire outside an active run.
   * `tokens` / `percent` are null right after compaction until the next LLM reply.
   */
  z.object({
    type: z.literal('context.updated'),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    tokens: z.number().nonnegative().nullable(),
    contextWindow: z.number().positive(),
    percent: z.number().min(0).max(100).nullable(),
  }),
  z.object({
    type: z.literal('compaction.started'),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    reason: z.enum(['manual', 'auto']).optional(),
  }),
  z.object({
    type: z.literal('compaction.completed'),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    aborted: z.boolean(),
    reason: z.enum(['manual', 'auto']).optional(),
    summary: z.string().optional(),
    tokensBefore: z.number().nonnegative().optional(),
    estimatedTokensAfter: z.number().nonnegative().optional(),
  }),
  /**
   * Auto model routing (#21) abandoned the current model mid-run and retried
   * the same user turn on the next model in the chain. Run-scoped so the
   * renderer can badge the switch on the run it belongs to.
   */
  z
    .object({
      type: z.literal('model.auto-switched'),
      from: ModelRefSchema,
      to: ModelRefSchema,
      /** Why the previous model was abandoned. */
      reason: z.enum(['rate-limit', 'timeout', 'quota', 'error']),
    })
    .merge(EventScopeSchema),
  /**
   * Auto-retry visibility (#8): the provider/transport layer is retrying the
   * same model call after a transient failure. Pi emits this before each
   * backoff sleep — the UI shows “Retrying attempt N/M” instead of looking
   * frozen. The run itself stays alive.
   */
  z
    .object({
      type: z.literal('run.retry-started'),
      /** 1-indexed retry attempt. */
      attempt: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
      /** Backoff delay before the retried call, in ms. */
      delayMs: z.number().nonnegative(),
      errorMessage: z.string().optional(),
    })
    .merge(EventScopeSchema),
  /** The retry loop settled: success on a later call, or exhausted. */
  z
    .object({
      type: z.literal('run.retry-finished'),
      success: z.boolean(),
      attempt: z.number().int().positive(),
      finalError: z.string().optional(),
    })
    .merge(EventScopeSchema),
  /**
   * App auto-update status (check / download / ready). Not run-scoped — Settings
   * and a future toast both listen so download percent can render live.
   */
  z.object({
    type: z.literal('update.status'),
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
    timestamp: z.number().int().nonnegative(),
  }),
]);
export type DesktopAgentEvent = z.infer<typeof DesktopAgentEventSchema>;
