import type { ApprovalDecision, DesktopAgentEvent } from '@pi-desktop/protocol';
import type { PermissionPipeline, PolicyContext } from '@pi-desktop/security';

export interface PermissionScope {
  context: PolicyContext;
  nextEventScope: () => Pick<
    DesktopAgentEvent,
    'projectId' | 'sessionId' | 'runId' | 'sequence' | 'timestamp'
  >;
}

export interface ToolCallLike {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface PermissionControllerOptions {
  pipeline: PermissionPipeline;
  getScope: () => PermissionScope | null;
  emit: (event: DesktopAgentEvent) => void;
}

/** Bridges Pi's blocking tool hook to Desktop's permission pipeline. */
export class PermissionController {
  constructor(private readonly options: PermissionControllerOptions) {}

  async authorize(toolCall: ToolCallLike): Promise<{ block?: boolean; reason?: string }> {
    const scope = this.options.getScope();
    if (!scope) {
      return { block: true, reason: 'No active Desktop run for tool authorization.' };
    }

    const result = this.options.pipeline.evaluate({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.input,
      ctx: scope.context,
    });

    if (result.action === 'allow') return {};
    if (result.action === 'deny') return { block: true, reason: result.message };

    const { requestId, decision } = this.options.pipeline.requestApproval(
      scope.context,
      result.tool,
      result.request,
      result.assessment,
    );
    this.options.emit({
      type: 'approval.requested',
      ...scope.nextEventScope(),
      requestId,
      ...result.request,
    });

    const resolved = await decision;
    this.options.emit({
      type: 'approval.resolved',
      ...scope.nextEventScope(),
      requestId,
      decision: resolved,
    });
    return resolved === 'deny' ? { block: true, reason: 'Tool execution denied by user.' } : {};
  }

  resolve(requestId: string, decision: ApprovalDecision): boolean {
    return this.options.pipeline.resolve(requestId, decision);
  }
}
