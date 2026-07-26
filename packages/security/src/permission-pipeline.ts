import { randomUUID } from 'node:crypto';

import type { ApprovalDecision } from '@pi-desktop/protocol';

import { AuditLog, redactSecrets } from './audit-log.js';
import { PolicyEngine, type ApprovalMode } from './policy-engine.js';
import { normalizeToolCall } from './tool-normalizer.js';
import type {
  ApprovalRequestDraft,
  NormalizedToolCall,
  PolicyAction,
  PolicyContext,
  RiskAssessment,
} from './types.js';

export interface PendingApproval {
  requestId: string;
  runId: string;
  sessionId: string;
  projectId: string;
  tool: NormalizedToolCall;
  assessment: RiskAssessment;
  draft: ApprovalRequestDraft;
  createdAt: number;
}

export interface PipelineEvaluateInput {
  toolCallId: string;
  toolName: string;
  args: unknown;
  ctx: PolicyContext;
}

/**
 * Orchestrates normalize → classify → policy → audit (plan M5).
 * Approval waiting is handled by callers via waitForDecision / resolve.
 */
export class PermissionPipeline {
  readonly policy: PolicyEngine;
  readonly audit: AuditLog;
  private readonly pending = new Map<
    string,
    {
      info: PendingApproval;
      resolve: (decision: ApprovalDecision) => void;
    }
  >();

  constructor(options?: {
    auditFilePath?: string;
    autoAllowWorkspaceWrite?: boolean;
    defaultMode?: ApprovalMode;
  }) {
    this.policy = new PolicyEngine({
      autoAllowWorkspaceWrite: options?.autoAllowWorkspaceWrite,
      defaultMode: options?.defaultMode,
    });
    this.audit = new AuditLog(options?.auditFilePath);
  }

  evaluate(input: PipelineEvaluateInput): PolicyAction & { tool: NormalizedToolCall } {
    const tool = normalizeToolCall({
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args,
      workspaceRoot: input.ctx.workspaceRoot,
    });
    const decision = this.policy.evaluate(tool, input.ctx);

    this.audit.append({
      projectId: input.ctx.projectId,
      sessionId: input.ctx.sessionId,
      runId: input.ctx.runId,
      kind: 'decision',
      toolName: tool.toolName,
      riskLevel: decision.assessment.level,
      outcome:
        decision.action === 'allow'
          ? 'allow'
          : decision.action === 'deny'
            ? 'deny'
            : 'require-approval',
      summary: redactSecrets(tool.summary),
      command: tool.command ? redactSecrets(tool.command) : undefined,
      affectedPaths: tool.affectedPaths,
      reasons: decision.assessment.reasons,
    });

    return { ...decision, tool };
  }

  /**
   * Register a pending approval and return a promise that resolves when the user decides.
   */
  requestApproval(
    ctx: PolicyContext,
    tool: NormalizedToolCall,
    draft: ApprovalRequestDraft,
    assessment: RiskAssessment,
  ): { requestId: string; decision: Promise<ApprovalDecision> } {
    const requestId = randomUUID();
    const info: PendingApproval = {
      requestId,
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
      tool,
      assessment,
      draft,
      createdAt: Date.now(),
    };

    let resolve!: (d: ApprovalDecision) => void;
    const decision = new Promise<ApprovalDecision>((r) => {
      resolve = r;
    });
    this.pending.set(requestId, { info, resolve });
    return { requestId, decision };
  }

  resolve(requestId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);

    if (decision !== 'deny') {
      this.policy.remember(
        { projectId: entry.info.projectId, sessionId: entry.info.sessionId },
        decision,
        entry.info.tool,
        entry.info.assessment.level,
      );
    }

    this.audit.append({
      projectId: entry.info.projectId,
      sessionId: entry.info.sessionId,
      runId: entry.info.runId,
      kind: 'approval',
      toolName: entry.info.tool.toolName,
      riskLevel: entry.info.assessment.level,
      outcome: decision === 'deny' ? 'denied' : 'approved',
      summary: redactSecrets(entry.info.draft.summary),
      command: entry.info.draft.command ? redactSecrets(entry.info.draft.command) : undefined,
      affectedPaths: entry.info.draft.affectedPaths,
      reasons: entry.info.draft.reasons,
      decision,
    });

    entry.resolve(decision);
    return true;
  }

  getPending(requestId: string): PendingApproval | undefined {
    return this.pending.get(requestId)?.info;
  }

  listPending(): PendingApproval[] {
    return [...this.pending.values()].map((p) => p.info);
  }
}
