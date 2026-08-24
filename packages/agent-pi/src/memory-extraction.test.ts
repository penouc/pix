import { describe, expect, it } from 'vitest';

import {
  filterNewMemories,
  parseMemoryExtractionReply,
  shouldAttemptMemoryExtraction,
} from './memory-extraction.js';

describe('memory-extraction', () => {
  it('parses a JSON array reply', () => {
    expect(
      parseMemoryExtractionReply('["Prefers TypeScript strict mode", "Uses pnpm"]'),
    ).toEqual(['Prefers TypeScript strict mode', 'Uses pnpm']);
  });

  it('parses JSON wrapped in prose', () => {
    expect(parseMemoryExtractionReply('Here:\n["Likes concise diffs"]')).toEqual([
      'Likes concise diffs',
    ]);
  });

  it('returns empty for none or empty array', () => {
    expect(parseMemoryExtractionReply('[]')).toEqual([]);
    expect(parseMemoryExtractionReply('none')).toEqual([]);
  });

  it('dedupes against existing memories', () => {
    const existing = [
      {
        id: '1',
        content: 'Prefers TypeScript',
        source: 'user' as const,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(
      filterNewMemories(['Prefers TypeScript', 'Uses pnpm monorepos'], existing),
    ).toEqual(['Uses pnpm monorepos']);
  });

  it('skips trivial exchanges', () => {
    expect(shouldAttemptMemoryExtraction({ userText: 'hi' })).toBe(false);
    expect(
      shouldAttemptMemoryExtraction({
        userText: 'Please remember I prefer TypeScript strict mode in all repos',
        assistantText: 'Got it.',
      }),
    ).toBe(true);
  });
});
