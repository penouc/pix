import assert from 'node:assert/strict';
import test from 'node:test';

test('acceptance: fast.js greet function still works after cancellation', async () => {
  const { greet } = await import('../src/fast.js?v=' + Date.now());
  assert.equal(greet('world'), 'Hello, world!');
});

test('acceptance: slow.js still exists (no destructive changes)', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(new URL('../src/slow.js', import.meta.url)));
});
