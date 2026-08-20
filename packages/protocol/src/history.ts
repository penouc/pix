import { z } from 'zod';

/** Agents that can appear in the history library / ACP launcher. */
export const HistoryAgentIdSchema = z.enum([
  'pix',
  'claude-code',
  'codex',
  'pi',
  'omp',
  'gemini',
  'opencode',
  'grok',
  'copilot',
]);
export type HistoryAgentId = z.infer<typeof HistoryAgentIdSchema>;

export const HistorySessionMetaSchema = z.object({
  /** Global key: `{agent}:{nativeId}` */
  key: z.string().min(1),
  agent: HistoryAgentIdSchema,
  nativeId: z.string().min(1),
  title: z.string(),
  projectPath: z.string(),
  projectName: z.string(),
  filePath: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  messageCount: z.number().int().nonnegative(),
  model: z.string().nullable().optional(),
  tokensUsed: z.number().int().nullable().optional(),
  favorite: z.boolean().default(false),
  /** PiX-owned sessions can open the live workbench; others are read-only / ACP. */
  origin: z.enum(['pix', 'external']).default('external'),
  /** When origin is pix, the desktop session id (same as nativeId for pix). */
  pixSessionId: z.string().optional(),
  pixProjectId: z.string().optional(),
});
export type HistorySessionMeta = z.infer<typeof HistorySessionMetaSchema>;

export const HistoryMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.enum(['text', 'thinking', 'tool']),
  text: z.string(),
  toolName: z.string().optional(),
  thinking: z.string().optional(),
  timestamp: z.number().int().nullable().optional(),
});
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;

export const HistoryTranscriptSchema = z.object({
  meta: HistorySessionMetaSchema,
  messages: z.array(HistoryMessageSchema),
});
export type HistoryTranscript = z.infer<typeof HistoryTranscriptSchema>;

export const HistoryAgentNavSchema = z.object({
  agent: HistoryAgentIdSchema,
  displayName: z.string(),
  count: z.number().int().nonnegative(),
  detected: z.boolean(),
  /** True when an ACP / in-app runtime can drive this agent. */
  runnable: z.boolean(),
});
export type HistoryAgentNav = z.infer<typeof HistoryAgentNavSchema>;

export const HistoryProjectNavSchema = z.object({
  path: z.string(),
  name: z.string(),
  count: z.number().int().nonnegative(),
  lastActive: z.number().int(),
  /** Linked PiX project id when this path was opened in the app. */
  pixProjectId: z.string().optional(),
  /** Hidden from the active Projects list when true. */
  archived: z.boolean().default(false),
});
export type HistoryProjectNav = z.infer<typeof HistoryProjectNavSchema>;

export const HistoryNavSchema = z.object({
  agents: z.array(HistoryAgentNavSchema),
  projects: z.array(HistoryProjectNavSchema),
  total: z.number().int().nonnegative(),
});
export type HistoryNav = z.infer<typeof HistoryNavSchema>;

export const HistoryListFilterSchema = z.object({
  agent: HistoryAgentIdSchema.optional(),
  projectPath: z.string().optional(),
  favoriteOnly: z.boolean().optional(),
  titleQuery: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type HistoryListFilter = z.infer<typeof HistoryListFilterSchema>;

export const HistoryResumeTargetSchema = z.enum(['terminal', 'acp']);
export type HistoryResumeTarget = z.infer<typeof HistoryResumeTargetSchema>;

export const HISTORY_AGENT_DISPLAY: Record<HistoryAgentId, string> = {
  pix: 'PiX',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  omp: 'Oh My Pi',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  grok: 'Grok Build',
  copilot: 'Copilot CLI',
};
