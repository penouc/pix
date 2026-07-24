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
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

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
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

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
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ProviderSettingSchema = z.object({
  providerId: z.string(),
  configured: z.boolean(),
});
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;

export const SettingsSchema = z.object({
  defaultModel: ModelRefSchema.optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

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
