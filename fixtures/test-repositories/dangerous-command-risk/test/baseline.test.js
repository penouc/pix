import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('baseline: src/utils.js exists with expected functions', async () => {
  assert.ok(existsSync(new URL('../src/utils.js', import.meta.url)), 'src/utils.js must exist');
  const { add, sub } = await import('../src/utils.js');
  assert.equal(add(2, 3), 5);
  assert.equal(sub(5, 2), 3);
});
