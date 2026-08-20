import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { homedir } from 'node:os';

import type { HistoryAgentId, HistoryMessage } from '@pi-desktop/protocol';

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
 * Pi / Oh My Pi share the same JSONL shape under different roots:
 * ~/.pi/agent/sessions and ~/.omp/agent/sessions (recursive .jsonl files).
 */
export class PiHistoryAdapter implements HistoryAgentAdapter {
  constructor(
    private readonly agentId: 'pi' | 'omp',
    private readonly root: string,
  ) {}

  static pi(): PiHistoryAdapter {
    return new PiHistoryAdapter('pi', path.join(homedir(), '.pi', 'agent', 'sessions'));
  }

  static omp(): PiHistoryAdapter {
    return new PiHistoryAdapter('omp', path.join(homedir(), '.omp', 'agent', 'sessions'));
  }

  agent(): HistoryAgentId {
    return this.agentId;
  }

  detect(): boolean {
    return existsSync(this.root);
  }

  watchPaths(): string[] {
    return this.detect() ? [this.root] : [];
  }

  async listSessionFiles(): Promise<SessionFileRef[]> {
    if (!this.detect()) return [];
    return listJsonlRecursive(this.root, this.agentId, nativeIdOfStem);
  }

  async parseSession(ref: SessionFileRef): Promise<ParsedSession | null> {
    const parsed = await parsePiJsonl(ref.filePath);
    if (!parsed) return null;
    const meta = buildMeta(this.agentId, ref, parsed);
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
    return { meta, units };
  }

  async parseTranscript(ref: SessionFileRef): Promise<ParsedTranscript | null> {
    const parsed = await parsePiJsonl(ref.filePath);
    if (!parsed) return null;
    return { meta: buildMeta(this.agentId, ref, parsed), messages: parsed.messages };
  }
}

function nativeIdOfStem(stem: string): string {
  const i = stem.lastIndexOf('_');
  return i >= 0 ? stem.slice(i + 1) : stem;
}

interface PiParse {
  sessionId?: string;
  cwd: string;
  createdAt: number;
  lastTs: number;
  messages: HistoryMessage[];
  model?: string;
  tokensUsed?: number;
}

async function parsePiJsonl(filePath: string): Promise<PiParse | null> {
  const p: PiParse = {
    cwd: '',
    createdAt: 0,
    lastTs: 0,
    messages: [],
  };
  const toolIndex = new Map<string, number>();

  try {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
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
      const type = row.type as string | undefined;
      if (type === 'session') {
        if (typeof row.id === 'string') p.sessionId = row.id;
        if (typeof row.cwd === 'string') p.cwd = row.cwd;
        if (typeof row.timestamp === 'string') p.createdAt = isoMs(row.timestamp);
        continue;
      }
      if (type !== 'message') continue;
      const msg = row.message as Record<string, unknown> | undefined;
      if (!msg) continue;
      const ts = isoMs(row.timestamp as string | undefined);
      p.lastTs = Math.max(p.lastTs, ts);
      const role = msg.role as string | undefined;
      const content = msg.content;
      if (role === 'user') {
        const text = blocksText(content);
        if (text) {
          p.messages.push({
            seq: 0,
            role: 'user',
            kind: 'text',
            text: clip(text),
            timestamp: ts,
          });
        }
      } else if (role === 'assistant') {
        const text = blocksText(content);
        const tools: Array<{ id: string; name: string; input: string }> = [];
        if (Array.isArray(content)) {
          for (const b of content) {
            const block = b as Record<string, unknown>;
            if (block.type === 'toolCall') {
              tools.push({
                id: String(block.id ?? ''),
                name: String(block.name ?? 'tool'),
                input: clip(JSON.stringify(block.arguments ?? {}), 16 * 1024),
              });
            }
          }
        }
        if (!text && tools.length === 0) continue;
        if (typeof msg.model === 'string') p.model = msg.model;
        const usage = msg.usage as { totalTokens?: number } | undefined;
        if (typeof usage?.totalTokens === 'number') p.tokensUsed = usage.totalTokens;

        const last = p.messages[p.messages.length - 1];
        if (!last || last.role !== 'assistant' || last.kind !== 'text') {
          p.messages.push({
            seq: 0,
            role: 'assistant',
            kind: 'text',
            text: '',
            timestamp: ts,
          });
        }
        const cur = p.messages[p.messages.length - 1]!;
        if (text) {
          cur.text = clip(cur.text ? `${cur.text}\n\n${text}` : text);
        }
        for (const tc of tools) {
          p.messages.push({
            seq: 0,
            role: 'assistant',
            kind: 'tool',
            text: tc.input,
            toolName: tc.name,
            timestamp: ts,
          });
          if (tc.id) toolIndex.set(tc.id, p.messages.length - 1);
        }
      } else if (role === 'toolResult') {
        const callId = msg.toolCallId as string | undefined;
        if (!callId) continue;
        const mi = toolIndex.get(callId);
        if (mi == null) continue;
        const text = blocksText(content);
        if (text) {
          const target = p.messages[mi]!;
          target.text = clip(`${target.text}\n→ ${text}`, 32 * 1024);
        }
      }
    }
  } catch {
    return null;
  }
  assignSeq(p.messages);
  return p;
}

function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    const block = b as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

function buildMeta(agent: HistoryAgentId, ref: SessionFileRef, p: PiParse) {
  const native = p.sessionId ?? ref.nativeId;
  return {
    key: `${agent}:${native}`,
    agent,
    nativeId: native,
    title: titleFromMessages(p.messages),
    projectPath: p.cwd,
    projectName: projectNameOf(p.cwd),
    filePath: ref.filePath,
    createdAt: p.createdAt > 0 ? p.createdAt : ref.mtimeMs,
    updatedAt: p.lastTs > 0 ? p.lastTs : ref.mtimeMs,
    messageCount: p.messages.filter((m) => m.kind === 'text').length,
    model: p.model ?? null,
    tokensUsed: p.tokensUsed ?? null,
    favorite: false,
    origin: 'external' as const,
  };
}

export async function listJsonlRecursive(
  root: string,
  agent: HistoryAgentId,
  nativeIdOf: (stem: string) => string,
): Promise<SessionFileRef[]> {
  const out: SessionFileRef[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const st = await stat(full);
        const stem = entry.name.replace(/\.jsonl$/i, '');
        out.push({
          agent,
          nativeId: nativeIdOf(stem),
          filePath: full,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      } catch {
        /* skip */
      }
    }
  }
  await walk(root);
  return out;
}
