import { describe, expect, it } from 'vitest';

import { resolveRunTimeoutMs, writeToolPath } from './pi-runtime.js';

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

describe('resolveRunTimeoutMs', () => {
  it('uses the default for missing or malformed values', () => {
    for (const value of [undefined, '', 'not-a-number', '60000ms', '-1', '1.5']) {
      expect(resolveRunTimeoutMs(value)).toBe(600_000);
    }
  });

  it('clamps valid values to the supported timer range', () => {
    expect(resolveRunTimeoutMs('1')).toBe(30_000);
    expect(resolveRunTimeoutMs('30000')).toBe(30_000);
    expect(resolveRunTimeoutMs('60000')).toBe(60_000);
    expect(resolveRunTimeoutMs('2147483648')).toBe(2_147_483_647);
  });
});
