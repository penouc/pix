import type { NormalizedToolCall } from './types.js';
import { isProtectedPath } from './protected-paths.js';
import {
  canonicalizePath,
  isPathInsideWorkspace,
  toWorkspaceRelative,
} from './path-utils.js';

/**
 * Normalize a raw tool invocation into structured fields for policy (plan §9).
 */
export function normalizeToolCall(input: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  workspaceRoot: string;
}): NormalizedToolCall {
  const toolName = (input.toolName || 'unknown').toLowerCase();
  const args = input.args ?? {};
  const rawPaths = extractRawPaths(toolName, args);
  const command = extractCommand(toolName, args);

  const affectedPaths: string[] = [];
  const relativePaths: string[] = [];
  let escapesWorkspace = false;
  let hitsProtectedPath = false;

  for (const raw of rawPaths) {
    const absolute = canonicalizePath(input.workspaceRoot, raw);
    affectedPaths.push(absolute);
    if (!isPathInsideWorkspace(input.workspaceRoot, absolute)) {
      escapesWorkspace = true;
    } else {
      const rel = toWorkspaceRelative(input.workspaceRoot, absolute);
      if (rel) relativePaths.push(rel);
    }
    if (isProtectedPath(absolute)) {
      hitsProtectedPath = true;
    }
  }

  // Shell command may reference paths not present as structured args.
  if (command) {
    const cmdPaths = extractPathsFromCommand(command);
    for (const raw of cmdPaths) {
      if (rawPaths.includes(raw)) continue;
      const absolute = canonicalizePath(input.workspaceRoot, raw);
      affectedPaths.push(absolute);
      if (!isPathInsideWorkspace(input.workspaceRoot, absolute)) {
        escapesWorkspace = true;
      }
      if (isProtectedPath(absolute)) {
        hitsProtectedPath = true;
      }
    }
  }

  return {
    toolCallId: input.toolCallId,
    toolName,
    summary: buildSummary(toolName, args, command, rawPaths),
    command,
    rawPaths,
    affectedPaths,
    relativePaths,
    escapesWorkspace,
    hitsProtectedPath,
    args,
  };
}

function extractRawPaths(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const rec = args as Record<string, unknown>;
  const keys = ['path', 'file_path', 'filePath', 'target', 'destination', 'src', 'dest'];
  const paths: string[] = [];
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) paths.push(v.trim());
  }
  if (Array.isArray(rec['paths'])) {
    for (const p of rec['paths']) {
      if (typeof p === 'string' && p.trim()) paths.push(p.trim());
    }
  }
  // bash often only has command
  if (toolName === 'bash' || toolName === 'shell') {
    // paths extracted from command separately
  }
  return paths;
}

function extractCommand(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const rec = args as Record<string, unknown>;
  if (typeof rec['command'] === 'string') return rec['command'];
  if ((toolName === 'bash' || toolName === 'shell') && typeof rec['cmd'] === 'string') {
    return rec['cmd'];
  }
  return undefined;
}

function extractPathsFromCommand(command: string): string[] {
  // Conservative: only absolute paths or ./ ../ relative tokens that look like paths.
  const tokens = command.split(/[\s"'`;|&]+/).filter(Boolean);
  return tokens.filter(
    (t) =>
      t.startsWith('/') ||
      t.startsWith('./') ||
      t.startsWith('../') ||
      t.includes('/') ||
      t.includes('\\'),
  );
}

function buildSummary(
  toolName: string,
  args: unknown,
  command: string | undefined,
  rawPaths: string[],
): string {
  if (command) return `${toolName}: ${command.slice(0, 200)}`;
  if (rawPaths[0]) return `${toolName}: ${rawPaths[0]}`;
  try {
    return `${toolName}: ${JSON.stringify(args).slice(0, 200)}`;
  } catch {
    return toolName;
  }
}
