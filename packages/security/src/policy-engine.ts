import type {
  NormalizedToolCall,
  PolicyAction,
  PolicyContext,
  RiskAssessment,
} from './types.js';
import { classifyRisk } from './risk-classifier.js';
import type { ApprovalDecision, RiskLevel } from './types.js';

export interface PolicyEngineOptions {
  /**
   * When true, workspace-write tools auto-allow (project trusted coding mode).
   * Default true for trusted projects.
   */
  autoAllowWorkspaceWrite?: boolean;
}

/**
 * Decide allow / deny / require-approval for a tool call (plan §9).
 * Also tracks allow-session / allow-project memory.
 */
export class PolicyEngine {
  private readonly sessionAllows = new Map<string, Set<string>>();
  private readonly projectAllows = new Map<string, Set<string>>();
  private readonly autoAllowWorkspaceWrite: boolean;

  constructor(options: PolicyEngineOptions = {}) {
    this.autoAllowWorkspaceWrite = options.autoAllowWorkspaceWrite ?? true;
  }

  evaluate(tool: NormalizedToolCall, ctx: PolicyContext): PolicyAction {
    if (!ctx.projectTrusted) {
      const assessment: RiskAssessment = {
        level: 'sensitive',
        reasons: ['Project is not trusted'],
        rememberable: false,
      };
      return {
        action: 'deny',
        assessment,
        message: 'Project is not trusted. Trust the workspace before running agent tools.',
      };
    }

    const assessment = classifyRisk(tool);

    if (tool.escapesWorkspace && assessment.level !== 'external-side-effect') {
      // Escape is always at least sensitive and requires confirmation.
    }

    const memoryKey = memoryKeyFor(tool, assessment.level);
    if (this.isRemembered(ctx, memoryKey)) {
      return { action: 'allow', assessment };
    }

    switch (assessment.level) {
      case 'safe':
        return { action: 'allow', assessment };
      case 'workspace-write':
        if (this.autoAllowWorkspaceWrite) {
          return { action: 'allow', assessment };
        }
        return requireApproval(tool, assessment);
      case 'sensitive':
      case 'destructive':
      case 'external-side-effect':
        return requireApproval(tool, assessment);
      default:
        return requireApproval(tool, assessment);
    }
  }

  remember(
    ctx: Pick<PolicyContext, 'projectId' | 'sessionId'>,
    decision: ApprovalDecision,
    tool: NormalizedToolCall,
    riskLevel: RiskLevel,
  ): void {
    if (decision === 'deny' || decision === 'allow-once') return;
    if (riskLevel === 'destructive' || riskLevel === 'external-side-effect') {
      // Plan: external-side-effect never fuzzy remember; destructive limits memory.
      if (riskLevel === 'external-side-effect') return;
      if (decision === 'allow-project') return; // only session-level for destructive
    }
    const key = memoryKeyFor(tool, riskLevel);
    if (decision === 'allow-session') {
      const set = this.sessionAllows.get(ctx.sessionId) ?? new Set();
      set.add(key);
      this.sessionAllows.set(ctx.sessionId, set);
    }
    if (decision === 'allow-project' && riskLevel !== 'destructive') {
      const set = this.projectAllows.get(ctx.projectId) ?? new Set();
      set.add(key);
      this.projectAllows.set(ctx.projectId, set);
    }
  }

  clearSession(sessionId: string): void {
    this.sessionAllows.delete(sessionId);
  }

  private isRemembered(ctx: PolicyContext, key: string): boolean {
    if (this.sessionAllows.get(ctx.sessionId)?.has(key)) return true;
    if (this.projectAllows.get(ctx.projectId)?.has(key)) return true;
    return false;
  }
}

function memoryKeyFor(tool: NormalizedToolCall, level: RiskLevel): string {
  // Group by tool + risk + primary path/command pattern (not full free-form args).
  const focus = tool.command?.split(/\s+/)[0] ?? tool.relativePaths[0] ?? tool.toolName;
  return `${tool.toolName}|${level}|${focus}`;
}

function requireApproval(
  tool: NormalizedToolCall,
  assessment: RiskAssessment,
): PolicyAction {
  return {
    action: 'require-approval',
    assessment,
    request: {
      toolName: tool.toolName,
      summary: tool.summary,
      command: tool.command,
      affectedPaths: tool.affectedPaths,
      riskLevel: assessment.level,
      reasons: assessment.reasons,
      rememberable: assessment.rememberable,
    },
  };
}
