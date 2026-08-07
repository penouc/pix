import type { NormalizedToolCall, PolicyAction, PolicyContext, RiskAssessment } from './types.js';
import { classifyRisk } from './risk-classifier.js';
import type { ApprovalDecision, RiskLevel } from './types.js';

/**
 * How much a session may do without asking.
 *
 * - `ask` — every mutation (write/edit and bash) waits for a decision.
 * - `auto-reads` — trusted projects run every tool without asking. The legacy
 *   wire value is retained for persisted settings, but the UI calls it “Auto”.
 * - `read-only` — nothing is written and no command runs; mutations are refused
 *   outright rather than queued for approval.
 */
export type ApprovalMode = 'ask' | 'auto-reads' | 'read-only';

export interface RememberedRule {
  scope: 'session' | 'project';
  scopeId: string;
  toolName: string;
  riskLevel: string;
  /** The command word or path the rule was keyed on. */
  focus: string;
  key: string;
}

export interface PolicyEngineOptions {
  /**
   * Legacy switch, kept so existing callers keep their behaviour: it selects the
   * starting default mode (`true` → 'auto-reads', `false` → 'ask').
   */
  autoAllowWorkspaceWrite?: boolean;
  defaultMode?: ApprovalMode;
}

/**
 * Decide allow / deny / require-approval for a tool call (plan §9).
 * Also tracks allow-session / allow-project memory.
 */
export class PolicyEngine {
  private readonly sessionAllows = new Map<string, Set<string>>();
  private readonly projectAllows = new Map<string, Set<string>>();
  private readonly sessionModes = new Map<string, ApprovalMode>();
  /** Plan vs build — orthogonal to approval mode. */
  private readonly sessionWorkModes = new Map<string, 'plan' | 'build'>();
  private defaultMode: ApprovalMode;
  private defaultWorkMode: 'plan' | 'build' = 'build';

  constructor(options: PolicyEngineOptions = {}) {
    this.defaultMode =
      options.defaultMode ?? ((options.autoAllowWorkspaceWrite ?? true) ? 'auto-reads' : 'ask');
  }

  /** Mode for new sessions. */
  setDefaultMode(mode: ApprovalMode): void {
    this.defaultMode = mode;
  }

  getDefaultMode(): ApprovalMode {
    return this.defaultMode;
  }

  setSessionMode(sessionId: string, mode: ApprovalMode): void {
    this.sessionModes.set(sessionId, mode);
  }

  getMode(sessionId?: string): ApprovalMode {
    if (sessionId) return this.sessionModes.get(sessionId) ?? this.defaultMode;
    return this.defaultMode;
  }

  setSessionWorkMode(sessionId: string, mode: 'plan' | 'build'): void {
    this.sessionWorkModes.set(sessionId, mode);
  }

  setDefaultWorkMode(mode: 'plan' | 'build'): void {
    this.defaultWorkMode = mode;
  }

  getWorkMode(sessionId?: string): 'plan' | 'build' {
    if (sessionId) return this.sessionWorkModes.get(sessionId) ?? this.defaultWorkMode;
    return this.defaultWorkMode;
  }

  /** Remembered allow rules, for the Settings screen. Never includes secrets. */
  listRemembered(): RememberedRule[] {
    const rules: RememberedRule[] = [];
    const push = (scope: 'session' | 'project', scopeId: string, key: string) => {
      const [toolName = key, riskLevel = 'unknown', focus = ''] = key.split('|');
      rules.push({ scope, scopeId, toolName, riskLevel, focus, key });
    };
    for (const [sessionId, keys] of this.sessionAllows) {
      for (const key of keys) push('session', sessionId, key);
    }
    for (const [projectId, keys] of this.projectAllows) {
      for (const key of keys) push('project', projectId, key);
    }
    return rules;
  }

  /** Forget remembered rules. Returns how many were dropped. */
  clearRemembered(filter?: { scope?: 'session' | 'project'; scopeId?: string }): number {
    let removed = 0;
    const sweep = (store: Map<string, Set<string>>, scope: 'session' | 'project') => {
      if (filter?.scope && filter.scope !== scope) return;
      for (const [id, keys] of [...store]) {
        if (filter?.scopeId && filter.scopeId !== id) continue;
        removed += keys.size;
        store.delete(id);
      }
    };
    sweep(this.sessionAllows, 'session');
    sweep(this.projectAllows, 'project');
    return removed;
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
    const mode = this.getMode(ctx.sessionId);
    const workMode = this.getWorkMode(ctx.sessionId);

    // Plan Mode fail-closed: even if a write tool somehow remains registered,
    // refuse mutations instead of queuing them for approval.
    if (workMode === 'plan' && isPlanForbiddenTool(tool.toolName)) {
      return {
        action: 'deny',
        assessment: {
          level: assessment.level === 'safe' ? 'workspace-write' : assessment.level,
          reasons: [...assessment.reasons, 'Session is in Plan Mode'],
          rememberable: false,
        },
        message:
          'This session is in Plan Mode. Switch to Build before writing files or running shell commands.',
      };
    }

    // Read-only refuses rather than queues: the point of the mode is that
    // nothing can be written even by answering a prompt. Checked before the
    // remembered-rules lookup so an earlier allow cannot re-open the door.
    if (mode === 'read-only' && assessment.level !== 'safe') {
      return {
        action: 'deny',
        assessment,
        message:
          'This session is read-only. Switch the approval mode to let the agent write or run commands.',
      };
    }

    // “Auto” must actually be automatic. The old implementation only allowed
    // reads and workspace writes, so every bash command still opened a dialog
    // despite the UI saying Auto. Workspace trust remains the hard safety gate
    // above, while Ask and Read-only retain their stricter behaviour.
    if (mode === 'auto-reads') {
      return { action: 'allow', assessment };
    }

    const memoryKey = memoryKeyFor(tool, assessment.level);
    if (this.isRemembered(ctx, memoryKey)) {
      return { action: 'allow', assessment };
    }

    switch (assessment.level) {
      case 'safe':
        return { action: 'allow', assessment };
      case 'workspace-write':
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

function requireApproval(tool: NormalizedToolCall, assessment: RiskAssessment): PolicyAction {
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

function isPlanForbiddenTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === 'write' ||
    name === 'edit' ||
    name === 'bash' ||
    name === 'shell' ||
    name === 'apply_patch' ||
    name === 'applypatch'
  );
}
