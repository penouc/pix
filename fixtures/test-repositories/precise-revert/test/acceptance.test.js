import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('acceptance: footer.js copyright year is 2025', () => {
  const src = readFileSync(new URL('../src/footer.js', import.meta.url), 'utf8');
  assert.match(src, /2025/, 'footer.js must have 2025 after agent run');
});

