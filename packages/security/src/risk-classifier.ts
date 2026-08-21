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
    case 'hash_lines':
    case 'lsp_diagnostics':
    case 'lsp_references':
    case 'todo':
    case 'ask':
    case 'git_status':
    case 'git_diff':
    case 'git_log':
      // #11/#12: todo and ask only mutate in-session checklist/ask state; #13:
      // hash_lines only reads and hashes a file; #14: lsp_diagnostics and
      // lsp_references only read; #16: structured git read tools — no
      // filesystem writes, shell, or network — so all are safe and never enter
      // the queue.
      if (!tool.escapesWorkspace && !tool.hitsProtectedPath) {
        level = 'safe';
        if (reasons.length === 0) reasons.push('Read-only tool inside workspace');
      }
      break;
    case 'memory': {
      // recall is read-only. User-scope writes hit app SQLite (safe).
      // Project-scope retain/forget write `.pi-desktop/agent/memory.json`.
      const action =
        tool.args && typeof tool.args === 'object' && 'action' in tool.args
          ? String((tool.args as { action?: unknown }).action ?? '')
          : '';
      const scope =
        tool.args && typeof tool.args === 'object' && 'scope' in tool.args
          ? String((tool.args as { scope?: unknown }).scope ?? 'project')
          : 'project';
      if (action === 'recall') {
        if (!tool.escapesWorkspace && !tool.hitsProtectedPath) {
          level = 'safe';
          if (reasons.length === 0) reasons.push('Memory recall is read-only');
        }
      } else if (scope === 'user') {
        if (!tool.escapesWorkspace && !tool.hitsProtectedPath) {
          level = 'safe';
          if (reasons.length === 0) reasons.push('Writes user saved memories in the app database');
        }
      } else {
        raise('workspace-write', 'Writes project memory notes');
      }
      break;
    }
    case 'write':
    case 'edit':
    case 'apply_patch':
    case 'lsp_rename':
    case 'git_commit':
    case 'learn':
      raise(
        'workspace-write',
        tool.toolName === 'git_commit'
          ? 'Stages and commits locally (never pushes)'
          : tool.toolName === 'learn'
            ? 'Writes a skill under .pi/skills'
            : 'Modifies workspace files',
      );
      break;
    case 'web_search':
      // #18: network fetch — never rememberable as allow-session/project.
      raise('external-side-effect', 'Fetches results from the public web');
      break;
    case 'bash':
    case 'shell':
      classifyBash(tool.command ?? '', raise);
      break;
    default:
      if (tool.toolName.startsWith('mcp__')) {
        // #19: MCP tools are fail-closed to sensitive unless a server config
        // narrows risk (handled at registration description; classifier stays
        // conservative here because config is not on the NormalizedToolCall).
        raise('sensitive', `MCP tool "${tool.toolName}" requires approval`);
      } else {
        raise('sensitive', `Unknown tool "${tool.toolName}" treated as sensitive`);
      }
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
