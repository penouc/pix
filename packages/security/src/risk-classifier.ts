import type { NormalizedToolCall, RiskAssessment } from './types.js';
import type { RiskLevel } from './types.js';

const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  'workspace-write': 1,
  sensitive: 2,
  destructive: 3,
  'external-side-effect': 4,
};

/**
 * Classify risk for a normalized tool call (plan §9.1).
 */
export function classifyRisk(tool: NormalizedToolCall): RiskAssessment {
  const reasons: string[] = [];
  let level: RiskLevel = 'safe';

  const raise = (next: RiskLevel, reason: string) => {
    if (RISK_RANK[next] > RISK_RANK[level]) level = next;
    reasons.push(reason);
  };

  if (tool.escapesWorkspace) {
    raise('sensitive', 'Path escapes workspace root');
  }
  if (tool.hitsProtectedPath) {
    raise('sensitive', 'Touches protected/sensitive path');
  }

  switch (tool.toolName) {
    case 'read':
    case 'grep':
    case 'find':
    case 'ls':
    case 'glob':
      if (!tool.escapesWorkspace && !tool.hitsProtectedPath) {
        level = 'safe';
        if (reasons.length === 0) reasons.push('Read-only tool inside workspace');
      }
      break;
    case 'write':
    case 'edit':
    case 'apply_patch':
      raise('workspace-write', 'Modifies workspace files');
      break;
    case 'bash':
    case 'shell':
      classifyBash(tool.command ?? '', raise);
      break;
    default:
      raise('sensitive', `Unknown tool "${tool.toolName}" treated as sensitive`);
  }

  const rememberable = level === 'safe' || level === 'workspace-write' || level === 'sensitive';
  return { level, reasons: reasons.length ? reasons : ['Default safe'], rememberable };
}

function classifyBash(
  command: string,
  raise: (level: RiskLevel, reason: string) => void,
): void {
  const cmd = command.trim();
  if (!cmd) {
    raise('sensitive', 'Empty bash command');
    return;
  }

  const lower = cmd.toLowerCase();

  // External side effects
  if (/\bgit\s+push\b/.test(lower)) {
    raise('external-side-effect', 'git push publishes to remote');
  }
  if (/\b(npm|pnpm|yarn)\s+publish\b/.test(lower)) {
    raise('external-side-effect', 'Package publish to registry');
  }
  if (/\b(curl|wget)\b.*\|\s*(ba)?sh\b/.test(lower) || /\bcurl\b.*\b-d\b/.test(lower)) {
    raise('external-side-effect', 'Network fetch/pipe may exfiltrate or run remote code');
  }
  if (/\b(docker\s+push|gh\s+release|terraform\s+apply|kubectl\s+apply)\b/.test(lower)) {
    raise('external-side-effect', 'Deploy/release side effect');
  }

  // Destructive
  if (/\brm\s+(-[a-z]*f|-[a-z]*r|-\w*rf|-\w*fr)\b/i.test(cmd) || /\brm\s+-rf\b/i.test(cmd)) {
    raise('destructive', 'Recursive/forced delete (rm -rf)');
  }
  if (/\bgit\s+reset\s+--hard\b/.test(lower) || /\bgit\s+clean\s+-fd/.test(lower)) {
    raise('destructive', 'Destructive git history/workdir wipe');
  }
  if (/\b(dd\s+if=|mkfs\.|diskutil\s+erase)\b/.test(lower)) {
    raise('destructive', 'Low-level disk wipe operation');
  }
  if (/\bchmod\s+-R\b/.test(lower) || /\bchown\s+-R\b/.test(lower)) {
    raise('destructive', 'Recursive permission ownership change');
  }

  // Sensitive
  if (/\b(npm|pnpm|yarn|bun)\s+i(nstall)?\b/.test(lower)) {
    raise('sensitive', 'Dependency install may run lifecycle scripts');
  }
  if (/\bcurl\b|\bwget\b|\bnc\b|\bncat\b/.test(lower)) {
    raise('sensitive', 'Network utility in shell');
  }
  if (/\bsudo\b/.test(lower)) {
    raise('sensitive', 'Elevated privileges (sudo)');
  }
  if (/\beval\b|\bsource\s+<\(/.test(lower)) {
    raise('sensitive', 'Dynamic code evaluation in shell');
  }

  // If still at safe after bash, treat plain commands as workspace-write-ish sensitive baseline
  // Actually bash always has side effects potential — default at least sensitive if no higher.
  // Plan: "git status" is safe. Detect readonly git/commands.
  if (
    /^\s*git\s+(status|diff|log|show|branch|rev-parse)\b/i.test(cmd) ||
    /^\s*(ls|pwd|echo|cat|head|tail|wc|which|node\s+--version)\b/i.test(cmd)
  ) {
    // leave at safe unless already raised
    if (arguments.length) {
      // no-op — only raise if still safe we set reason
    }
  } else {
    // generic bash
    raise('sensitive', 'Shell command may have side effects');
  }
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}
