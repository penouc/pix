import { z } from 'zod';

import { IpcResultSchema } from './ipc.js';
import { DesktopAgentEventSchema } from './events.js';

/** Default LAN port for the Phase-1 companion host. */
export const COMPANION_DEFAULT_PORT = 7847;

/**
 * IPC methods the phone companion may call.
 * Desktop-only surface (folder picker, terminal, keychain, …) stays off this list.
 */
export const COMPANION_ALLOWED_METHODS = [
  'app.getInfo',
  'project.listRecent',
  'session.list',
  'session.messages',
  'session.create',
  'agent.sendMessage',
  'agent.followUp',
  'agent.steer',
  'agent.abort',
  'agent.resolveApproval',
  'agent.listModels',
] as const;

export type CompanionAllowedMethod = (typeof COMPANION_ALLOWED_METHODS)[number];

export const CompanionAllowedMethodSchema = z.enum(COMPANION_ALLOWED_METHODS);

export const CompanionStatusSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  port: z.number().int().positive(),
  /** Six-digit code shown in Settings; required on WebSocket hello. */
  pairingCode: z.string().min(4).max(12),
  /** Reachable http(s) URLs for the companion UI (LAN interfaces). */
  urls: z.array(z.string()),
  clients: z.number().int().nonnegative(),
});
export type CompanionStatus = z.infer<typeof CompanionStatusSchema>;

/** Client → host after the socket opens. */
export const CompanionHelloSchema = z.object({
  type: z.literal('hello'),
  pairingCode: z.string().min(1).max(32),
  /** Optional client label for logs (e.g. "iPhone Safari"). */
  clientName: z.string().max(80).optional(),
});
export type CompanionHello = z.infer<typeof CompanionHelloSchema>;

/** Client → host: same envelope shape as desktop IPC invoke. */
export const CompanionInvokeSchema = z.object({
  type: z.literal('invoke'),
  id: z.string().min(1).max(128),
  method: CompanionAllowedMethodSchema,
  params: z.unknown().optional(),
});
export type CompanionInvoke = z.infer<typeof CompanionInvokeSchema>;

export const CompanionClientMessageSchema = z.discriminatedUnion('type', [
  CompanionHelloSchema,
  CompanionInvokeSchema,
]);
export type CompanionClientMessage = z.infer<typeof CompanionClientMessageSchema>;

export const CompanionHelloOkSchema = z.object({
  type: z.literal('hello.ok'),
  status: CompanionStatusSchema.pick({ port: true, urls: true }),
});
export type CompanionHelloOk = z.infer<typeof CompanionHelloOkSchema>;

export const CompanionHelloErrSchema = z.object({
  type: z.literal('hello.err'),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type CompanionHelloErr = z.infer<typeof CompanionHelloErrSchema>;

export const CompanionResultSchema = z.object({
  type: z.literal('result'),
  id: z.string().min(1),
  result: IpcResultSchema,
});
export type CompanionResult = z.infer<typeof CompanionResultSchema>;

export const CompanionEventSchema = z.object({
  type: z.literal('event'),
  event: DesktopAgentEventSchema,
});
export type CompanionEvent = z.infer<typeof CompanionEventSchema>;

export const CompanionHostMessageSchema = z.discriminatedUnion('type', [
  CompanionHelloOkSchema,
  CompanionHelloErrSchema,
  CompanionResultSchema,
  CompanionEventSchema,
]);
export type CompanionHostMessage = z.infer<typeof CompanionHostMessageSchema>;

export function parseCompanionClientMessage(raw: unknown) {
  return CompanionClientMessageSchema.safeParse(raw);
}

export function parseCompanionHostMessage(raw: unknown) {
  return CompanionHostMessageSchema.safeParse(raw);
}
