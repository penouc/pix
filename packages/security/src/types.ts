import type { ApprovalDecision, RiskLevel } from '@pi-desktop/protocol';

export type { ApprovalDecision, RiskLevel };

/** Normalized tool call ready for policy evaluation (plan §9). */
export interface NormalizedToolCall {
  toolCallId: string;
  toolName: string;
  /** Human-readable summary for UI / audit */
  summary: string;
  /** Shell command if applicable */
  command?: string;
  /** Paths the tool intends to touch (raw, pre-resolve) */
  rawPaths: string[];
  /** Canonical absolute paths after resolve + realpath best-effort */
  affectedPaths: string[];
  /** Workspace-relative paths when inside root */
  relativePaths: string[];
  /** True if any path escapes workspace after canonicalize */
  escapesWorkspace: boolean;
  /** True if any path matches protected-path rules */
  hitsProtectedPath: boolean;
  args: unknown;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  /** Whether allow-session / allow-project memory is permitted for this risk */
  rememberable: boolean;
}

export type PolicyAction =
  | { action: 'allow'; assessment: RiskAssessment }
  | { action: 'deny'; assessment: RiskAssessment; message: string }
  | {
      action: 'require-approval';
      assessment: RiskAssessment;
      request: ApprovalRequestDraft;
    };

export interface ApprovalRequestDraft {
  toolName: string;
  summary: string;
  command?: string;
  affectedPaths: string[];
  riskLevel: RiskLevel;
  reasons: string[];
  rememberable: boolean;
}

export interface PolicyContext {
  projectId: string;
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  /** Project trusted for agent use */
  projectTrusted: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  projectId: string;
  sessionId: string;
  runId: string;
  kind: 'decision' | 'approval' | 'execution';
  toolName: string;
  riskLevel: RiskLevel;
  outcome: 'allow' | 'deny' | 'require-approval' | 'approved' | 'denied' | 'executed';
  summary: string;
  command?: string;
  affectedPaths: string[];
  reasons: string[];
  decision?: ApprovalDecision;
}
