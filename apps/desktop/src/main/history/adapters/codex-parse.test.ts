import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CodexHistoryAdapter } from './codex.js';

describe('CodexHistoryAdapter parse', () => {
  let dir = '';

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('extracts title and messages from event_msg rollout format', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'codex-parse-'));
    const file = path.join(dir, 'rollout-test.jsonl');
    const lines = [
      {
        timestamp: '2026-08-20T10:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'sess-1', cwd: '/Users/me/demo-app' },
      },
      {
        timestamp: '2026-08-20T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>' }],
        },
      },
      {
        timestamp: '2026-08-20T10:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Fix the login button color' },
      },
      {
        timestamp: '2026-08-20T10:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'agent_reasoning', text: 'Looking at the CSS…' },
      },
      {
        timestamp: '2026-08-20T10:00:04.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'I will update `Button.tsx`.\n\n```ts\nconst x = 1\n```' },
      },
      {
        timestamp: '2026-08-20T10:00:05.000Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'exec', input: 'ls' },
      },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const adapter = new CodexHistoryAdapter();
    const parsed = await adapter.parseSession({
      agent: 'codex',
      nativeId: 'sess-1',
      filePath: file,
      mtimeMs: Date.now(),
      size: 100,
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.meta.title).toBe('Fix the login button color');
    expect(parsed!.meta.projectName).toBe('demo-app');
    expect(parsed!.meta.nativeId).toBe('sess-1');

    const transcript = await adapter.parseTranscript({
      agent: 'codex',
      nativeId: 'sess-1',
      filePath: file,
      mtimeMs: Date.now(),
      size: 100,
    });
    expect(transcript!.messages.some((m) => m.kind === 'thinking')).toBe(true);
    expect(transcript!.messages.some((m) => m.kind === 'tool' && m.toolName === 'exec')).toBe(true);
    expect(transcript!.messages.find((m) => m.role === 'assistant' && m.kind === 'text')?.text).toContain(
      'Button.tsx',
    );
  });
});
