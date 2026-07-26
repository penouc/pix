import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('post-revert: footer.js copyright year returns to 2024', () => {
  const src = readFileSync(new URL('../src/footer.js', import.meta.url), 'utf8');
  assert.match(src, /2024/, 'footer.js must return to 2024 after revert');
});

test('post-revert: pre-existing header.js change is preserved', () => {
  const src = readFileSync(new URL('../src/header.js', import.meta.url), 'utf8');
  assert.match(src, /My Application/, 'header.js uncommitted change must be preserved');
});
