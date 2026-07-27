import { describe, expect, it } from 'vitest';

import { expandPiMessagesToTranscript } from './pi-runtime.js';

describe('expandPiMessagesToTranscript', () => {
  it('emits thinking and tool cards from assistant content parts', () => {
    const out = expandPiMessagesToTranscript([
      { role: 'user', content: 'look at README' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I will read the file' },
          { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'README.md' } },
          { type: 'text', text: 'Here is what I found.' },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'read',
        content: [{ type: 'text', text: '# Hello' }],
      },
    ]);

    expect(out).toEqual([
      { kind: 'message', role: 'user', text: 'look at README' },
      { kind: 'thinking', id: 'pi-think-1', content: 'I will read the file' },
      {
        kind: 'tool',
        id: 'tc1',
        toolName: 'read',
        inputSummary: 'read: README.md',
        status: 'completed',
        ok: true,
        outputSummary: '# Hello',
      },
      { kind: 'message', role: 'assistant', text: 'Here is what I found.' },
    ]);
  });
});
