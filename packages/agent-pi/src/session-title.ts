/**
 * Helpers for auto-naming a new task after its first completed turn.
 *
 * The model call itself lives on the runtime; this module owns the prompt and
 * the post-processing so Fake/Pi and unit tests share one definition of "good".
 */

export const SESSION_TITLE_SYSTEM_PROMPT = [
  'You name coding-agent tasks for a sidebar list.',
  'Reply with ONLY a short title (about 3–8 words).',
  'No quotes, no trailing punctuation, no explanation, no markdown.',
  "Match the user's language.",
].join(' ');

export function buildSessionTitleUserPrompt(input: {
  userText: string;
  assistantText?: string;
}): string {
  const user = clip(input.userText, 1200);
  const assistant = input.assistantText?.trim()
    ? clip(input.assistantText.trim(), 800)
    : '(no assistant reply yet)';
  return [
    'Name this task based on the first exchange.',
    '',
    'User:',
    user,
    '',
    'Assistant:',
    assistant,
  ].join('\n');
}

/** Collapse a model reply (or heuristic line) into a sidebar-safe title. */
export function sanitizeSessionTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  let cleaned = firstLine
    // Drop common wrappers the model still sneaks in.
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^\**\s*title\s*[:：-]\s*/i, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing sentence punctuation looks odd in a list row.
    .replace(/[.。!！?？:;：；]+$/g, '')
    .trim();

  if (cleaned.length < 2) return null;
  // Reject replies that are clearly an explanation rather than a label.
  if (/^(here('s| is)|sure[, ]|i (would|can)|the title)/i.test(cleaned)) return null;

  if (cleaned.length > 72) {
    cleaned = `${cleaned.slice(0, 71).trimEnd()}…`;
  }
  return cleaned;
}

/**
 * Cheap offline title from the first user prompt. Used as a fallback when the
 * model call fails, and by FakeAgentRuntime so offline smoke stays deterministic.
 */
export function deriveSessionTitle(text: string): string | null {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^([`>#\-*]|\d+\.)/.test(line));
  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3) return null;

  const capped = cleaned.length > 72 ? `${cleaned.slice(0, 71).trimEnd()}…` : cleaned;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
