import type { SavedMemory } from '@pi-desktop/protocol';

import { extractTextContent } from './event-mapper.js';

/**
 * Side-channel prompt for ChatGPT-style memory extraction after a completed turn.
 * The model call never touches the agent transcript.
 */
export const MEMORY_EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable facts about the user for a coding-agent memory store.',
  'Reply with ONLY a JSON array of strings — each string is one concise fact (≤120 chars).',
  'Include preferences, constraints, names, tooling choices, or recurring habits the user stated.',
  'Skip code details, task status, secrets, API keys, passwords, and one-off requests.',
  'If nothing is worth remembering across future projects, reply exactly: []',
  'Match the user\'s language.',
].join(' ');

export function buildMemoryExtractionUserPrompt(input: {
  userText: string;
  assistantText?: string;
  existingMemories: SavedMemory[];
}): string {
  const existing =
    input.existingMemories.length > 0
      ? input.existingMemories
          .slice(0, 40)
          .map((m) => `- ${m.content}`)
          .join('\n')
      : '(none yet)';

  const user = clip(input.userText, 1600);
  const assistant = input.assistantText?.trim()
    ? clip(input.assistantText.trim(), 1200)
    : '(no assistant reply)';

  return [
    'Existing saved memories (do not duplicate):',
    existing,
    '',
    'Latest exchange:',
    'User:',
    user,
    '',
    'Assistant:',
    assistant,
    '',
    'Return only new facts worth remembering across projects as a JSON string array.',
  ].join('\n');
}

/** Parse the model reply into candidate memory strings. */
export function parseMemoryExtractionReply(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return [];

  const jsonStart = trimmed.indexOf('[');
  const jsonEnd = trimmed.lastIndexOf(']');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // fall through to line parsing
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^none$/i.test(line) && !/^[[\],]+$/.test(line));
}

/** Drop duplicates and facts already covered by existing memories. */
export function filterNewMemories(
  candidates: string[],
  existing: SavedMemory[],
  max = 3,
): string[] {
  const existingLower = existing.map((m) => m.content.toLowerCase().trim());
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of candidates) {
    const content = raw.trim().slice(0, 2000);
    if (!content || content.length < 8) continue;
    const lower = content.toLowerCase();
    if (seen.has(lower)) continue;
    if (existingLower.some((e) => e === lower || e.includes(lower) || lower.includes(e))) continue;
    seen.add(lower);
    out.push(content);
    if (out.length >= max) break;
  }

  return out;
}

export function shouldAttemptMemoryExtraction(exchange: {
  userText: string;
  assistantText?: string;
}): boolean {
  const user = exchange.userText.trim();
  if (user.length < 15) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)[\s!.?]*$/i.test(user)) return false;
  return true;
}

/** Last user message and the assistant reply that follows it. */
export function collectRecentExchange(
  messages: Array<{ role?: string; content?: unknown }>,
): { userText: string; assistantText?: string } | null {
  const texts: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const message of messages) {
    const role = message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = extractTextContent(message.content).trim();
    if (!text) continue;
    texts.push({ role, text });
  }

  for (let i = texts.length - 1; i >= 0; i--) {
    if (texts[i]?.role !== 'user') continue;
    const userText = texts[i]!.text;
    const assistantText = texts.slice(i + 1).find((entry) => entry.role === 'assistant')?.text;
    return assistantText ? { userText, assistantText } : { userText };
  }

  return null;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
