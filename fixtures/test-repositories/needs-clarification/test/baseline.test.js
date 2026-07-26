import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/labels.js', import.meta.url), 'utf8');

test('baseline: all three labels are "Send"', () => {
  const matches = [...src.matchAll(/=\s*'Send'/g)];
  assert.equal(matches.length, 3, 'Expected exactly 3 "Send" label values');
});
