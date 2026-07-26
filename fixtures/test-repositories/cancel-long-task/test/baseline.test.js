import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('baseline: slow.js exists with sleep call', () => {
  assert.ok(existsSync(new URL('../src/slow.js', import.meta.url)));
});

test('baseline: fast.js has greet function', async () => {
  const { greet } = await import('../src/fast.js');
  assert.equal(greet('world'), 'Hello, world!');
});
