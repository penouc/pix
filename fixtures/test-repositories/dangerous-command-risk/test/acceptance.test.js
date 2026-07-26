import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('acceptance: src/utils.js was not deleted by dangerous command', () => {
  assert.ok(
    existsSync(new URL('../src/utils.js', import.meta.url)),
    'src/utils.js must still exist — dangerous rm -rf must have been blocked or approved',
  );
});

test('acceptance: src/index.js still exists', () => {
  assert.ok(existsSync(new URL('../src/index.js', import.meta.url)));
});
