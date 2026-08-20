import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { homedir } from 'node:os';

import type { HistoryMessage } from '@pi-desktop/protocol';

import { listJsonlRecursive } from './pi.js';
import {
  assignSeq,
  clip,
  isoMs,
  projectNameOf,
  titleFromMessages,
  type HistoryAgentAdapter,
  type ParsedSession,
  type ParsedTranscript,
  type SessionFileRef,
} from '../types.js';

/**
 * Claude Code stores sessions at `~/.claude/projects/<encoded-cwd>/*.jsonl`.
 * The project directory name is a lossy encoding of the cwd (slashes → `-`).
 */
export class ClaudeHistoryAdapter implements HistoryAgentAdapter {
  private readonly root = path.join(homedir(), '.claude', 'projects');

  agent() {
    return 'claude-code' as const;
  }

  detect(): boolean {
    return existsSync(this.root);
  }

  watchPaths(): string[] {
    return this.detect() ? [this.root] : [];
  }

  async listSessionFiles(): Promise<SessionFileRef[]> {
    if (!this.detect()) return [];
    return listJsonlRecursive(this.root, 'claude-code', (stem) => stem);
  }

  async parseSession(ref: SessionFileRef): Promise<ParsedSession | null> {
    const parsed = await parseClaudeJsonl(ref);
    if (!parsed) return null;
    const units = parsed.messages
      .filter((m) => m.kind === 'text' && m.text.trim())
      .map((m) => ({
        seq: m.seq,
        role: m.role,
        kind: m.kind,
        text: clip(m.text),
        toolName: m.toolName,
        thinking: m.thinking,
        timestamp: m.timestamp,
      }));
    return { meta: parsed.meta, units };
  }

  async parseTranscript(ref: SessionFileRef): Promise<ParsedTranscript | null> {
    return parseClaudeJsonl(ref);
  }
}

interface ClaudeParse {
  meta: ParsedTranscript['meta'];
  messages: HistoryMessage[];
}

async function parseClaudeJsonl(ref: SessionFileRef): Promise<ClaudeParse | null> {
  const messages: HistoryMessage[] = [];
  let cwd = decodeClaudeProjectDir(path.dirname(ref.filePath));
  let createdAt = ref.mtimeMs;
  let lastTs = ref.mtimeMs;
  let model: string | undefined;
  let sessionId = ref.nativeId;

  try {
    const rl = readline.createInterface({
      input: createReadStream(ref.filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof row.sessionId === 'string') sessionId = row.sessionId;
      if (typeof row.cwd === 'string') cwd = row.cwd;
      const ts = isoMs((row.timestamp as string | number | undefined) ?? null);
      if (ts) {
        if (!createdAt || createdAt === ref.mtimeMs) createdAt = Math.min(createdAt || ts, ts);
        lastTs = Math.max(lastTs, ts);
      }
      const type = row.type as string | undefined;
      if (type === 'user' || row.role === 'user') {
        const text = extractClaudeText(row.message ?? row);
        if (text) {
          messages.push({ seq: 0, role: 'user', kind: 'text', text: clip(text), timestamp: ts || null });
        }
      } else if (type === 'assistant' || row.role === 'assistant') {
        const msg = (row.message ?? row) as Record<string, unknown>;
        if (typeof msg.model === 'string') model = msg.model;
        const text = extractClaudeText(msg);
        const thinking = extractThinking(msg);
        if (thinking) {
          messages.push({
            seq: 0,
            role: 'assistant',
            kind: 'thinking',
            text: clip(thinking),
            thinking: clip(thinking),
            timestamp: ts || null,
          });
        }
        if (text) {
          messages.push({
            seq: 0,
            role: 'assistant',
            kind: 'text',
            text: clip(text),
            timestamp: ts || null,
          });
        }
        for (const tool of extractTools(msg)) {
          messages.push({
            seq: 0,
            role: 'assistant',
            kind: 'tool',
            text: tool.input,
            toolName: tool.name,
            timestamp: ts || null,
          });
        }
      }
    }
  } catch {
    return null;
  }

  assignSeq(messages);
  return {
    meta: {
      key: `claude-code:${sessionId}`,
      agent: 'claude-code',
      nativeId: sessionId,
      title: titleFromMessages(messages),
      projectPath: cwd,
      projectName: projectNameOf(cwd),
      filePath: ref.filePath,
      createdAt,
      updatedAt: lastTs,
      messageCount: messages.filter((m) => m.kind === 'text').length,
      model: model ?? null,
      tokensUsed: null,
      favorite: false,
      origin: 'external',
    },
    messages,
  };
}

/** `~/.claude/projects/-Users-pen-dev-pix` → `/Users/pen/dev/pix` (best effort). */
function decodeClaudeProjectDir(dir: string): string {
  const base = path.basename(dir);
  if (!base.startsWith('-')) return '';
  // Claude encodes absolute paths by replacing `/` with `-`.
  return base.replace(/-/g, '/');
}

function extractClaudeText(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as Record<string, unknown>;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => {
        const block = b as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof m.text === 'string') return m.text;
  return '';
}

function extractThinking(msg: Record<string, unknown>): string {
  if (!Array.isArray(msg.content)) return '';
  return msg.content
    .map((b) => {
      const block = b as Record<string, unknown>;
      if (block.type === 'thinking' && typeof block.thinking === 'string') return block.thinking;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractTools(msg: Record<string, unknown>): Array<{ name: string; input: string }> {
  if (!Array.isArray(msg.content)) return [];
  const out: Array<{ name: string; input: string }> = [];
  for (const b of msg.content) {
    const block = b as Record<string, unknown>;
    if (block.type === 'tool_use') {
      out.push({
        name: String(block.name ?? 'tool'),
        input: clip(JSON.stringify(block.input ?? {}), 16 * 1024),
      });
    }
  }
  return out;
}
