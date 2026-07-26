import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('baseline: header.js has pre-existing uncommitted change', () => {
  const src = readFileSync(new URL('../src/header.js', import.meta.url), 'utf8');
  assert.match(src, /My Application/, 'header.js should have the pre-existing edit');
});

test('baseline: footer.js has 2024', () => {
  const src = readFileSync(new URL('../src/footer.js', import.meta.url), 'utf8');
  assert.match(src, /2024/);
});
