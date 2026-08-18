/**
 * Helpers for auto-naming a new task after its first completed turn.
 *
 * The model call itself lives on the runtime; this module owns the prompt and
 * the post-processing so Fake/Pi and unit tests share one definition of "good".
 */

/** Sidebar session titles — short enough for the task list and title bar. */
export const MAX_SESSION_TITLE_LENGTH = 10;

export const SESSION_TITLE_SYSTEM_PROMPT = [
  'You name coding-agent tasks for a sidebar list.',
  `Reply with ONLY a short title (at most ${MAX_SESSION_TITLE_LENGTH} characters).`,
  'For Chinese, use at most 10 汉字. For English, use a very short phrase.',
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
    `Name this task in at most ${MAX_SESSION_TITLE_LENGTH} characters based on the first exchange.`,
    '',
    'User:',
    user,
    '',
    'Assistant:',
    assistant,
  ].join('\n');
}

/** Hard cap for sidebar display (counts Unicode code points, not UTF-16 units). */
export function capSessionTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const chars = [...trimmed];
  if (chars.length <= MAX_SESSION_TITLE_LENGTH) return trimmed;
  return chars.slice(0, MAX_SESSION_TITLE_LENGTH).join('');
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

  cleaned = capSessionTitle(cleaned);
  return cleaned.length >= 2 ? cleaned : null;
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

  const capped = capSessionTitle(cleaned);
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
