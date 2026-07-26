import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');

test('baseline: config.js has expected exports', () => {
  assert.match(src, /APP_NAME/);
  assert.match(src, /VERSION/);
});

test('baseline: no /etc/hosts content present', () => {
  assert.doesNotMatch(src, /localhost|127\.0\.0\.1/);
});
