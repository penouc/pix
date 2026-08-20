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
  type HistoryAgentAdapter,
  type ParsedSession,
  type ParsedTranscript,
  type SessionFileRef,
} from '../types.js';

/**
 * Codex CLI sessions live under ~/.codex/sessions (recursive .jsonl).
 * Current rollout lines look like:
 *   { type: "session_meta"|"response_item"|"event_msg"|"turn_context", payload, timestamp }
 * Prefer `event_msg` for the readable transcript; use `response_item` for tools
 * and as a fallback when older rollouts lack event_msg.
 */
export class CodexHistoryAdapter implements HistoryAgentAdapter {
  private readonly root = path.join(homedir(), '.codex', 'sessions');

  agent() {
    return 'codex' as const;
  }

  detect(): boolean {
    return existsSync(this.root) || existsSync(path.join(homedir(), '.codex'));
  }

  watchPaths(): string[] {
    return existsSync(this.root) ? [this.root] : [];
  }

  async listSessionFiles(): Promise<SessionFileRef[]> {
    if (!existsSync(this.root)) return [];
    return listJsonlRecursive(this.root, 'codex', (stem) => stem);
  }

  async parseSession(ref: SessionFileRef): Promise<ParsedSession | null> {
    const parsed = await parseCodexJsonl(ref);
    if (!parsed) return null;
    const units = parsed.messages
      .filter(
        (m) =>
          (m.kind === 'text' || m.kind === 'thinking') &&
          (m.text.trim() || m.thinking?.trim()),
      )
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
    return parseCodexJsonl(ref);
  }
}

async function parseCodexJsonl(ref: SessionFileRef): Promise<ParsedTranscript | null> {
  const fromEvents: HistoryMessage[] = [];
  const fromItems: HistoryMessage[] = [];
  const tools: HistoryMessage[] = [];
  let cwd = '';
  let createdAt = ref.mtimeMs;
  let lastTs = ref.mtimeMs;
  let model: string | undefined;
  let sessionId = ref.nativeId;
  let sawEventMessages = false;

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

      const topType = String(row.type ?? '');
      const ts = isoMs(
        (row.timestamp as string | number | undefined) ??
          (row.created_at as string | number | undefined) ??
          null,
      );
      if (ts) {
        createdAt = Math.min(createdAt, ts);
        lastTs = Math.max(lastTs, ts);
      }

      const payload = (row.payload ?? {}) as Record<string, unknown>;

      if (topType === 'session_meta') {
        if (typeof payload.id === 'string') sessionId = payload.id;
        if (typeof payload.session_id === 'string') sessionId = payload.session_id;
        if (typeof payload.cwd === 'string') cwd = payload.cwd;
        continue;
      }

      if (topType === 'turn_context') {
        if (typeof payload.cwd === 'string' && !cwd) cwd = payload.cwd;
        if (typeof payload.model === 'string') model = payload.model;
        continue;
      }

      if (topType === 'event_msg') {
        const eventType = String(payload.type ?? '');
        if (eventType === 'user_message') {
          const text = typeof payload.message === 'string' ? payload.message : '';
          if (text.trim() && !isBoilerplateUserText(text)) {
            sawEventMessages = true;
            fromEvents.push({
              seq: 0,
              role: 'user',
              kind: 'text',
              text: clip(text),
              timestamp: ts || null,
            });
          }
        } else if (eventType === 'agent_message') {
          const text = typeof payload.message === 'string' ? payload.message : '';
          if (text.trim()) {
            sawEventMessages = true;
            fromEvents.push({
              seq: 0,
              role: 'assistant',
              kind: 'text',
              text: clip(text),
              timestamp: ts || null,
            });
          }
        } else if (eventType === 'agent_reasoning') {
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (text.trim()) {
            fromEvents.push({
              seq: 0,
              role: 'assistant',
              kind: 'thinking',
              text: clip(text),
              thinking: clip(text),
              timestamp: ts || null,
            });
          }
        }
        continue;
      }

      if (topType === 'response_item') {
        const itemType = String(payload.type ?? '');
        if (itemType === 'message') {
          const role = String(payload.role ?? '');
          const text = extractCodexContent(payload.content);
          if (!text.trim() || isBoilerplateUserText(text)) continue;
          if (role === 'user' || role === 'assistant') {
            fromItems.push({
              seq: 0,
              role,
              kind: 'text',
              text: clip(text),
              timestamp: ts || null,
            });
          }
        } else if (itemType === 'function_call' || itemType === 'custom_tool_call') {
          const name = String(payload.name ?? payload.tool ?? itemType);
          const input = clip(
            typeof payload.input === 'string'
              ? payload.input
              : JSON.stringify(payload.arguments ?? payload.command ?? payload.input ?? {}),
            16 * 1024,
          );
          tools.push({
            seq: 0,
            role: 'assistant',
            kind: 'tool',
            text: input,
            toolName: name,
            timestamp: ts || null,
          });
        } else if (itemType === 'reasoning') {
          const summaryText = extractReasoningSummary(payload.summary);
          if (summaryText) {
            fromItems.push({
              seq: 0,
              role: 'assistant',
              kind: 'thinking',
              text: clip(summaryText),
              thinking: clip(summaryText),
              timestamp: ts || null,
            });
          }
        }
      }
    }
  } catch {
    return null;
  }

  // Prefer the event_msg transcript when present (cleaner, no env dumps).
  const messages = [...(sawEventMessages ? fromEvents : fromItems), ...tools];
  messages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  assignSeq(messages);
  const title = pickCodexTitle(messages);

  return {
    meta: {
      key: `codex:${sessionId}`,
      agent: 'codex',
      nativeId: sessionId,
      title,
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

function pickCodexTitle(messages: HistoryMessage[]): string {
  const fromUser = messages.find(
    (m) => m.role === 'user' && m.kind === 'text' && m.text.trim() && !isWeakTitleText(m.text),
  );
  if (fromUser) return clipTitle(fromUser.text);

  const fromAssistant = messages.find(
    (m) =>
      m.role === 'assistant' &&
      m.kind === 'text' &&
      m.text.trim() &&
      !m.text.trimStart().startsWith('{'),
  );
  if (fromAssistant) return clipTitle(fromAssistant.text);

  if (messages.some((m) => m.role === 'user' && m.text.includes('Codex agent history'))) {
    return 'Permission review';
  }
  return 'Untitled';
}

function clipTitle(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? 'Untitled';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function extractCodexContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (typeof b === 'string') return b;
      const block = b as Record<string, unknown>;
      if (typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractReasoningSummary(summary: unknown): string {
  if (typeof summary === 'string') return summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map((s) => {
      if (typeof s === 'string') return s;
      const block = s as Record<string, unknown>;
      if (typeof block.text === 'string') return block.text;
      if (typeof block.summary === 'string') return block.summary;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Skip Codex injection wrappers so titles come from the real user prompt. */
function isBoilerplateUserText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith('<environment_context>') ||
    t.startsWith('<recommended_plugins>') ||
    t.startsWith('<plugins_') ||
    t.startsWith('<agent_')
  );
}

/** Still stored in the transcript, but skipped when picking a list title. */
function isWeakTitleText(text: string): boolean {
  const t = text.trimStart();
  return (
    isBoilerplateUserText(t) ||
    t.startsWith('The following is the Codex agent history') ||
    t.startsWith('# Browser comments:') ||
    t.startsWith('<in-app-browser-context')
  );
}
