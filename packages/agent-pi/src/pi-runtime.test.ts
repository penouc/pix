import { describe, expect, it } from 'vitest';

import { writeToolPath } from './pi-runtime.js';

describe('Pi write tool bridge', () => {
  it('forwards only write/edit paths from SDK-shaped tool calls', () => {
    expect(writeToolPath('write', { path: 'src/a.ts', content: 'x' })).toBe('src/a.ts');
    expect(writeToolPath('edit', { path: '/workspace/src/a.ts', edits: [] })).toBe(
      '/workspace/src/a.ts',
    );
    expect(writeToolPath('read', { path: 'src/a.ts' })).toBeUndefined();
    expect(writeToolPath('write', { file: 'src/a.ts' })).toBeUndefined();
  });
});
