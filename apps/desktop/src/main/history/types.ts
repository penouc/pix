import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { HistoryAgentId, HistoryMessage, HistorySessionMeta } from '@pi-desktop/protocol';

export interface SessionFileRef {
  agent: HistoryAgentId;
  nativeId: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

export interface ParsedSession {
  meta: HistorySessionMeta;
  units: Array<{
    seq: number;
    role: HistoryMessage['role'];
    kind: HistoryMessage['kind'];
    text: string;
    toolName?: string;
    thinking?: string;
    timestamp?: number | null;
  }>;
}

export interface ParsedTranscript {
  meta: HistorySessionMeta;
  messages: HistoryMessage[];
}

/**
 * Read-only adapter over another coding agent's on-disk sessions.
 * Never writes to the agent's directories; never reads credential files.
 */
export interface HistoryAgentAdapter {
  agent(): HistoryAgentId;
  detect(): boolean;
  listSessionFiles(): Promise<SessionFileRef[]>;
  parseSession(ref: SessionFileRef): Promise<ParsedSession | null>;
  parseTranscript(ref: SessionFileRef): Promise<ParsedTranscript | null>;
  watchPaths(): string[];
}

export const CREDENTIAL_BASENAMES = new Set([
  'auth.json',
  '.credentials.json',
  'credentials.json',
  'api-key',
  'api_key',
]);

export function isCredentialPath(filePath: string): boolean {
  const base = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return CREDENTIAL_BASENAMES.has(base);
}

export function projectNameOf(projectPath: string): string {
  if (!projectPath) return '';
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/**
 * Canonical project identity for the history library sidebar.
 * Resolves `~`, `file://`, `.`/`..`, trailing slashes, and realpath when the
 * directory exists so Claude/Codex/Pi sessions in the same folder merge.
 */
export function normalizeProjectPath(raw: string): string {
  if (!raw) return '';
  let p = raw.trim();
  if (!p) return '';
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//, ''));
    } catch {
      p = p.replace(/^file:\/\//, '');
    }
  }
  if (p.startsWith('~/') || p === '~') {
    p = path.join(homedir(), p.slice(1));
  }
  try {
    p = path.resolve(p);
  } catch {
    return stripTrailingSlash(p.replace(/\\/g, '/'));
  }
  try {
    if (existsSync(p)) p = realpathSync(p);
  } catch {
    /* keep resolved path */
  }
  return stripTrailingSlash(p);
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    return p.replace(/[/\\]+$/, '');
  }
  return p;
}

function pathDepth(projectPath: string): number {
  const parts = projectPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    // Windows drive letter (C:) is not a path segment for depth.
    .filter((part, index) => !(index === 0 && /^[A-Za-z]:$/.test(part)));
  return parts.length;
}

/** `/`, `/Users`, `/Users/x`, `/tmp` etc. must not swallow every child project. */
export function isBroadProjectPath(projectPath: string): boolean {
  const p = normalizeProjectPath(projectPath);
  if (!p || p === '/' || /^[A-Za-z]:\\?$/.test(p)) return true;
  return pathDepth(p) < 3;
}

/** Walk parents for a `.git` file/dir; returns normalized root or null. */
export function findGitRoot(projectPath: string): string | null {
  const start = normalizeProjectPath(projectPath);
  if (!start) return null;
  let cur = start;
  for (;;) {
    const git = path.join(cur, '.git');
    try {
      if (existsSync(git)) return normalizeProjectPath(cur);
    } catch {
      /* ignore */
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Map raw cwd strings → one sidebar project key.
 * 1) normalize (+ realpath)
 * 2) prefer git root when present
 * 3) roll up into the shortest non-broad ancestor that also appears in `knownPaths`
 *    so `stockk/frontend` merges into `stockk`, worktrees into the repo root, etc.
 */
export function resolveProjectIdentities(knownPaths: string[]): Map<string, string> {
  const normalized = [
    ...new Set(knownPaths.map((p) => normalizeProjectPath(p)).filter(Boolean)),
  ];
  const afterGit = new Map<string, string>();
  for (const p of normalized) {
    afterGit.set(p, findGitRoot(p) ?? p);
  }

  const candidates = new Set<string>([...normalized, ...afterGit.values()]);
  const mergeTargets = [...candidates].filter((p) => !isBroadProjectPath(p));

  const out = new Map<string, string>();
  for (const p of normalized) {
    let id = afterGit.get(p) ?? p;
    const ancestors = mergeTargets.filter((t) => isSameOrAncestorPath(t, id));
    if (ancestors.length) {
      ancestors.sort((a, b) => a.length - b.length);
      id = ancestors[0]!;
    }
    out.set(p, id);
  }
  return out;
}

/** True when `child` is `parent` or lives under it (OS-aware separators). */
function isSameOrAncestorPath(parent: string, child: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

/** Single-path helper when the full known set is not available yet. */
export function resolveProjectIdentity(raw: string, knownPaths: string[] = []): string {
  const n = normalizeProjectPath(raw);
  if (!n) return '';
  if (!knownPaths.length) return findGitRoot(n) ?? n;
  return resolveProjectIdentities([n, ...knownPaths]).get(n) ?? findGitRoot(n) ?? n;
}

export function clip(text: string, max = 32 * 1024): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function titleFromMessages(messages: HistoryMessage[]): string {
  const user = messages.find((m) => m.role === 'user' && m.kind === 'text' && m.text.trim());
  if (!user) return 'Untitled';
  const line = user.text.trim().split(/\r?\n/)[0] ?? 'Untitled';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function isoMs(value: string | number | undefined | null): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function assignSeq(messages: HistoryMessage[]): void {
  messages.forEach((m, i) => {
    m.seq = i;
  });
}
